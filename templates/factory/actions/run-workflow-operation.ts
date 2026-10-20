import {
  defineAction,
  isAgentConnectionRequiredError,
} from "@agent-native/core/action";
import { z } from "zod";

import { reportConnectionStatusMismatch } from "../server/lib/connection-status-tripwire.js";
import { factoryIdFromAutomationName } from "../server/lib/factory-automation-resources.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { failWorkflowAction } from "../server/lib/workflow-action-errors.js";
import { assertResultWithinLimit } from "../server/lib/workflow-action-support.js";
import {
  actionTripwire,
  noteCredentialSource,
} from "../server/lib/workflow-run-observer.js";
import { errorDetails, scrub } from "../server/tripwire/index.js";
import type { TripwireSink } from "../server/tripwire/index.js";
import {
  PROVIDER_PAYLOAD_BUDGET_CHARS,
  ProviderOperationError,
  buildProviderRequest,
  parseProviderResponse,
  type BuiltProviderRequest,
  type ParsedOperationResponse,
  type ProviderObservation,
} from "../server/workflow-host/provider-request.js";
import type { WorkflowScope } from "../server/workflow/adapter.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import type { OperationDefinition } from "../server/workflow/operations.js";

const PROVIDER_CALL_TIMEOUT_MS = 60_000;
// Core hands a tool result to the engine as indented JSON and cuts it at
// 50,000 characters. Indenting nested data can double its size, so the budget
// is checked on the indented text, not the compact one.
const RENDERED_RESULT_LIMIT_CHARS = 48_000;
const MAX_BUDGET_SHRINKS = 8;
const PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

// Where a person connects each provider: Dispatch holds connections, and the
// rest sign in with a key in the vault.
const CONNECTED_IN_DISPATCH = new Set([
  "slack",
  "github",
  "sentry",
  "hubspot",
  "jira",
  "notion",
  "bigquery",
]);

function connectHint(provider: string): string {
  return CONNECTED_IN_DISPATCH.has(provider)
    ? `Connect ${provider} in Dispatch, under Integrations.`
    : `Add the ${provider} credentials under Keys in Settings.`;
}

function credentialMissing(def: OperationDefinition): never {
  const provider = def.credential.provider;
  return failWorkflowAction({
    message: `${provider} is not connected for this workspace, so ${def.id} cannot run. ${connectHint(provider)}`,
    errorCode: "credential_missing",
    statusCode: 412,
    details: { operationId: def.id, provider },
  });
}

// What core throws, as plain errors, when it has no credential to send.
const NOT_CONFIGURED =
  /\bnot configured\b|requires an available workspace connection|require a workspace connectionId/;
// What core throws before any request leaves.
const REFUSED_BEFORE_SENDING =
  /^Blocked private\/internal provider URL|must stay on the configured provider host|^Unknown provider |^Unsupported HTTP method/;

/** Records one provider event for the call in hand; observe only. */
interface ProviderWatch {
  report(
    code: "provider_status_unexpected" | "provider_write_ambiguous",
    severity: "warn" | "error",
    details: Record<string, unknown>,
  ): void;
  reportShape(details: Record<string, unknown>): void;
}

function providerWatch(
  tripwire: TripwireSink,
  def: OperationDefinition,
  startedAt: number,
): ProviderWatch {
  const report: ProviderWatch["report"] = (code, severity, details) =>
    tripwire({
      area: "provider",
      code,
      severity,
      operationId: def.id,
      details: {
        provider: def.credential.provider,
        durationMs: Date.now() - startedAt,
        ...details,
      },
    });
  return {
    report,
    reportShape: (details) =>
      tripwire({
        area: "provider",
        code: "provider_shape_unexpected",
        severity: "warn",
        operationId: def.id,
        details: { provider: def.credential.provider, ...details },
      }),
  };
}

/** The credential source core reports for a call, in the words a tripwire uses; says nothing when core named none. */
function noteResponseCredential(
  def: OperationDefinition,
  result: unknown,
): void {
  const sources = (
    result as { request?: { credentialSources?: unknown } } | null
  )?.request?.credentialSources;
  const first: unknown = Array.isArray(sources) ? sources[0] : undefined;
  if (typeof first !== "object" || first === null) return;
  const { source, scope } = first as { source?: unknown; scope?: unknown };
  if (typeof source !== "string") return;
  const word =
    source === "workspace_connection" || source === "oauth_token"
      ? "workspace-connection"
      : scope === "deployment"
        ? "env"
        : "vault";
  noteCredentialSource({
    provider: def.credential.provider,
    source: word,
    operationId: def.id,
    details: {
      rawSource: source,
      ...(typeof scope === "string" ? { scopeKind: scope } : {}),
    },
  });
}

/** A 200 whose body says the provider did not do it: Slack's `ok: false`, BigQuery's `jobComplete: false`, a non-empty `errors` list. */
function providerFlag(json: unknown): Record<string, unknown> | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }
  const body = json as Record<string, unknown>;
  if (body.ok === false) {
    return { flag: "ok_false", errorWord: providerErrorWord(body) };
  }
  if (body.jobComplete === false) return { flag: "job_incomplete" };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return { flag: "errors_present", errorCount: body.errors.length };
  }
  return null;
}

function isCredentialAbsence(error: unknown): boolean {
  return (
    isAgentConnectionRequiredError(error) ||
    NOT_CONFIGURED.test(error instanceof Error ? error.message : "")
  );
}

function failFromCore(
  def: OperationDefinition,
  error: unknown,
  watch: ProviderWatch,
): never {
  if (isCredentialAbsence(error)) return credentialMissing(def);
  const message = error instanceof Error ? error.message : "";
  if (REFUSED_BEFORE_SENDING.test(message)) {
    return failWorkflowAction({
      message: `The ${def.credential.provider} request for ${def.id} was refused before it was sent.`,
      errorCode: "provider_request_refused",
      statusCode: 424,
      details: { operationId: def.id },
    });
  }
  // Core words its network failures as plain errors, so anything else may
  // have reached the provider: a write must be treated as possibly done.
  if (def.effect === "write") {
    watch.report("provider_write_ambiguous", "error", {
      via: "transport",
      timedOut: /timed out/i.test(message),
      ...errorDetails(error),
    });
    return failWorkflowAction({
      message: `The ${def.credential.provider} request for ${def.id} did not complete.`,
      errorCode: "provider_request_outcome_unknown",
      statusCode: 424,
      details: { operationId: def.id },
    });
  }
  return failWorkflowAction({
    message: `The ${def.credential.provider} request for ${def.id} ${/timed out/i.test(message) ? "timed out" : "could not be completed"}.`,
    errorCode: "provider_request_failed",
    statusCode: 424,
    retryable: true,
    details: { operationId: def.id },
  });
}

interface ProviderHttpResponse {
  status: number;
  ok: boolean;
  truncated: boolean;
  json: unknown;
  size: number;
}

function readResponse(result: unknown): {
  response: ProviderHttpResponse | null;
  sentPath: string;
} {
  const record = result as {
    response?: Partial<ProviderHttpResponse>;
    request?: { path?: unknown };
  } | null;
  const response = record?.response;
  const sentPath =
    typeof record?.request?.path === "string" ? record.request.path : "";
  if (
    !response ||
    typeof response.status !== "number" ||
    typeof response.ok !== "boolean"
  ) {
    return { response: null, sentPath };
  }
  return {
    response: {
      status: response.status,
      ok: response.ok,
      truncated: response.truncated === true,
      json: response.json,
      size: typeof response.size === "number" ? response.size : 0,
    },
    sentPath,
  };
}

const PLAIN_ERROR_WORD = /^[a-z][a-z0-9_]{0,47}$/;
const UNREADABLE_ERROR_WORD = "provider_error";

// The provider's own short error word (Slack's `channel_not_found`), never its
// body. Null when it sent none; a field that holds anything but a plain word,
// or a word that scrubs as a token, is `provider_error`, so it is never echoed.
function providerErrorWord(json: unknown): string | null {
  const word = (json as { error?: unknown } | null)?.error;
  if (word === undefined || word === null) return null;
  return typeof word === "string" &&
    PLAIN_ERROR_WORD.test(word) &&
    scrub(word) === word
    ? word
    : UNREADABLE_ERROR_WORD;
}

function failFromHttp(
  def: OperationDefinition,
  response: ProviderHttpResponse,
  watch: ProviderWatch,
): never {
  const { status } = response;
  const provider = def.credential.provider;
  const word = providerErrorWord(response.json);
  const detail = word ? ` (${word})` : "";
  const details = { operationId: def.id, status };
  // A list that 404s is not "nothing there": the typed code below cannot say so.
  const unexpectedStatus = () =>
    watch.report("provider_status_unexpected", "warn", {
      status,
      errorWord: word,
      body: response.json,
    });
  if (status === 401 || status === 403) {
    return failWorkflowAction({
      message: `${provider} refused the connected credential for ${def.id} (HTTP ${status}). ${connectHint(provider)}`,
      errorCode: "provider_access_denied",
      statusCode: 403,
      details,
    });
  }
  if (status === 404) {
    if (def.itemMapping) unexpectedStatus();
    return failWorkflowAction({
      message: `${provider} could not find what ${def.id} asked for${detail}.`,
      errorCode: "provider_not_found",
      statusCode: 404,
      // A record read by id may not exist yet (a call's transcript is made
      // after the call); a list that 404s is a wrong path and will not mend.
      retryable: def.effect === "read" && !def.itemMapping,
      details,
    });
  }
  if (status === 429) {
    return failWorkflowAction({
      message: `${provider} is rate limiting this workspace while running ${def.id}.`,
      errorCode: "provider_rate_limited",
      statusCode: 429,
      retryable: true,
      details,
    });
  }
  if (status === 408 || status >= 500) {
    if (def.effect === "write") {
      watch.report("provider_write_ambiguous", "error", {
        via: "http_status",
        status,
      });
    }
    return def.effect === "write"
      ? failWorkflowAction({
          message: `${provider} failed while running ${def.id} (HTTP ${status}).`,
          errorCode: "provider_request_outcome_unknown",
          statusCode: 424,
          details,
        })
      : failWorkflowAction({
          message: `${provider} failed while running ${def.id} (HTTP ${status}).`,
          errorCode: "provider_unavailable",
          statusCode: 424,
          retryable: true,
          details,
        });
  }
  unexpectedStatus();
  return failWorkflowAction({
    message: `${provider} rejected ${def.id} (HTTP ${status})${detail}.`,
    errorCode: "provider_rejected",
    statusCode: 424,
    details,
  });
}

function failUnexpected(def: OperationDefinition, message: string): never {
  // A write that got this far already ran: the engine must check it, not retry it.
  return failWorkflowAction({
    message,
    errorCode:
      def.effect === "write"
        ? "unexpected_response_outcome_unknown"
        : "unexpected_response",
    statusCode: 424,
    details: { operationId: def.id },
  });
}

const FIELD_ERROR_CODES: Record<string, string> = {
  invalid_table: "invalid_table",
  unsafe_path_value: "unsafe_path_value",
  unsafe_placeholder: "unsafe_placeholder",
};

function buildOrFail(
  def: OperationDefinition,
  input: Parameters<typeof buildProviderRequest>[1],
): BuiltProviderRequest {
  try {
    return buildProviderRequest(def, input);
  } catch (error) {
    if (!(error instanceof ProviderOperationError)) throw error;
    return failWorkflowAction({
      message: error.message,
      errorCode: FIELD_ERROR_CODES[error.code] ?? "operation_fields_invalid",
      statusCode: 400,
      details: { operationId: def.id, reason: error.code },
    });
  }
}

function envelope(
  def: OperationDefinition,
  status: number,
  parsed: ParsedOperationResponse,
) {
  return { ok: true as const, operationId: def.id, status, ...parsed };
}

/** Parses, and cuts the payload again while its indented form is still too big for the tool result. */
function parseWithinRenderedLimit(
  def: OperationDefinition,
  body: unknown,
  options: {
    scope: WorkflowScope;
    limit?: number;
    prime?: boolean;
    cursor?: string;
    status: number;
    observe: ProviderObservation;
  },
): ReturnType<typeof envelope> {
  let budgetChars = PROVIDER_PAYLOAD_BUDGET_CHARS;
  for (let shrinks = 0; shrinks <= MAX_BUDGET_SHRINKS; shrinks += 1) {
    const result = envelope(
      def,
      options.status,
      parseProviderResponse(def, body, {
        scope: options.scope,
        limit: options.limit,
        prime: options.prime,
        cursor: options.cursor,
        budgetChars,
        observe: options.observe,
      }),
    );
    if (JSON.stringify(result, null, 2).length <= RENDERED_RESULT_LIMIT_CHARS) {
      return result;
    }
    budgetChars = Math.floor(budgetChars * 0.7);
  }
  return failWorkflowAction({
    message: `${def.id} built a result that stays over the tool result limit even after it was cut down.`,
    errorCode: "output_over_cap",
    statusCode: 500,
    details: { operationId: def.id },
  });
}

type Args = { operationId: string };

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Run one provider operation from the workflow catalog (a Source, Lookup or Action node that calls a provider API: HubSpot, Pylon, Stripe, Gong, PostHog, BigQuery, Jira, Notion, Sentry, GitHub search, Slack user lookup). Only a workflow job whose saved graph names operationId may call it. The request comes from the code catalog, never from the caller: pass only field values, plus cursor, window and limit for a Source. Returns the provider's JSON as output (trimmed with truncated: true past the size budget), and for a Source the normalized items and the next cursor; a write also returns externalRef and url. A response that does not match the catalog's mapping fails with unexpected_response. Errors ending _outcome_unknown mean a write may already have happened: check, never retry.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    operationId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("A catalog operation id such as hubspot.newLeads."),
    fields: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("The operation's declared fields, by name."),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "A cursor Source's stored position. Omit on its first run: the request then asks for the newest page.",
      ),
    window: z
      .strictObject({
        from: z.string().trim().min(1).max(64),
        to: z.string().trim().min(1).max(64),
      })
      .optional()
      .describe("A window Source's span, as ISO timestamps."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("A Source's most items to return."),
    prime: z
      .boolean()
      .optional()
      .describe(
        "A cursor Source's first live run: take the position and return no items.",
      ),
  }),
  http: false,
  mcpTool: false,
  // The catalog, not the HTTP method, says whether this reads: a read that
  // POSTs (a CRM search, a SQL query) is still a read and may be retried.
  planMode: {
    effect: (args: Args) =>
      OPERATION_CATALOG.get(args.operationId)?.effect ?? "unknown",
    description:
      "Plan mode runs only operations the catalog declares as reads.",
  },
  retrySafe: (args: Args) =>
    OPERATION_CATALOG.get(args.operationId)?.effect === "read",
  audit: {
    recordInputs: false,
    target: (args: Args) => ({
      type: "workflow-operation",
      id: args.operationId,
      visibility: "org",
    }),
    summary: (args: Args, _result: unknown, meta: { status: string }) =>
      meta.status === "success"
        ? `Ran ${args.operationId}`
        : `Tried to run ${args.operationId}`,
  },
  run: async (
    {
      factoryId: requestedFactoryId,
      operationId,
      fields,
      cursor,
      window,
      limit,
      prime,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const factoryId =
      requestedFactoryId ??
      (context?.automation
        ? factoryIdFromAutomationName(context.automation.triggerName)
        : null);
    if (!factoryId) {
      failWorkflowAction({
        message:
          "This action needs a factoryId, or a calling workflow job that belongs to one factory.",
        errorCode: "factory_id_required",
        statusCode: 400,
      });
    }
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "workflow",
      factoryId,
      { operationId },
    );

    const def = OPERATION_CATALOG.get(operationId);
    if (!def || def.implementation.type !== "provider-request") {
      return failWorkflowAction({
        message: `${operationId} is not a provider operation this action can run.`,
        errorCode: "operation_not_in_catalog",
        statusCode: 404,
        details: { operationId },
      });
    }
    if (prime && (!def.cursor || cursor !== undefined)) {
      return failWorkflowAction({
        message: `${def.id} can only prime a cursor it has not stored yet.`,
        errorCode: "operation_fields_invalid",
        statusCode: 400,
        details: { operationId: def.id },
      });
    }

    const built = buildOrFail(def, { fields, cursor, window });
    const tripwire = actionTripwire({ orgId, factoryId });
    const startedAt = Date.now();
    const watch = providerWatch(tripwire, def, startedAt);
    let result: unknown;
    try {
      result = await executeProviderApiRequest({
        provider: def.credential.provider,
        method: built.method,
        path: built.path,
        ...(Object.keys(built.query).length > 0 ? { query: built.query } : {}),
        ...(built.body === undefined ? {} : { body: built.body }),
        timeoutMs: PROVIDER_CALL_TIMEOUT_MS,
        maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
        ...(context?.signal ? { signal: context.signal } : {}),
      });
    } catch (error) {
      if (isCredentialAbsence(error)) {
        await reportConnectionStatusMismatch({
          tripwire,
          provider: def.credential.provider,
          operationId: def.id,
          identity: { userEmail, orgId },
        });
      }
      return failFromCore(def, error, watch);
    }

    noteResponseCredential(def, result);
    const { response, sentPath } = readResponse(result);
    if (!response) {
      watch.reportShape({ reason: "answer_unreadable", body: result });
      return failUnexpected(
        def,
        `${def.id} got an answer from ${def.credential.provider} that Factory could not read.`,
      );
    }
    if (!response.ok) return failFromHttp(def, response, watch);

    const pathOnly = sentPath.split("?")[0].toLowerCase();
    const unresolved = built.openPlaceholders.filter(
      (name) =>
        pathOnly.includes(`{${name.toLowerCase()}}`) ||
        pathOnly.includes(`%7b${name.toLowerCase()}%7d`),
    );
    if (unresolved.length > 0) {
      return failWorkflowAction({
        message: `${def.credential.provider} has no default for ${unresolved.join(", ")}, so ${def.id} cannot build its request. Set it on the node, or finish connecting ${def.credential.provider}. ${connectHint(def.credential.provider)}`,
        errorCode: "provider_not_configured",
        statusCode: 412,
        details: { operationId: def.id, missing: unresolved },
      });
    }
    if (response.truncated) {
      watch.reportShape({
        reason: "response_truncated",
        status: response.status,
        size: response.size,
      });
      return failUnexpected(
        def,
        `${def.id} got a response cut at ${response.size} bytes, so it cannot be read whole.`,
      );
    }
    const flag = providerFlag(response.json);
    if (flag) {
      watch.reportShape({
        reason: "provider_flag",
        status: response.status,
        ...flag,
        body: response.json,
      });
    }

    let payload: ReturnType<typeof envelope>;
    try {
      payload = parseWithinRenderedLimit(def, response.json, {
        scope: { orgId, factoryId },
        limit,
        prime,
        cursor,
        status: response.status,
        observe: { tripwire, status: response.status },
      });
    } catch (error) {
      if (
        error instanceof ProviderOperationError &&
        error.code === "unexpected_response"
      ) {
        return failUnexpected(def, error.message);
      }
      throw error;
    }
    return assertResultWithinLimit("run-workflow-operation", payload);
  },
});
