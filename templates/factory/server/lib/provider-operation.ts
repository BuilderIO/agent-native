import { isAgentConnectionRequiredError } from "@agent-native/core/action";
import { buildProviderApiAuditSummary } from "@agent-native/core/provider-api/actions/provider-api-audit";

import { errorDetails, scrub } from "../tripwire/index.js";
import type { TripwireSink } from "../tripwire/index.js";
import {
  PROVIDER_PAYLOAD_BUDGET_CHARS,
  ProviderOperationError,
  buildProviderRequest,
  emptyRangeBody,
  parseProviderResponse,
  type BuiltProviderRequest,
  type ParsedOperationResponse,
  type ProviderObservation,
} from "../workflow-host/provider-request.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import {
  keepFields,
  parseFieldsToKeep,
  reportMissing,
  type FieldsToKeep,
  type MissingReport,
} from "../workflow/fields-to-keep.js";
import type { OperationDefinition } from "../workflow/operations.js";
import { reportConnectionStatusMismatch } from "./connection-status-tripwire.js";
import { executeProviderApiRequest } from "./provider-api.js";
import { failWorkflowAction } from "./workflow-action-errors.js";
import { assertResultWithinLimit } from "./workflow-action-support.js";
import {
  actionTripwire,
  noteCredentialSource,
} from "./workflow-run-observer.js";

/**
 * One provider operation of the workflow catalog, run through core's provider
 * runtime: the request is built from the catalog's definition and the field
 * values (never from a caller's path or method), sent with the connection's
 * credential, and the answer is bounded. Every failure is a typed
 * `WorkflowActionError`. The workflow action and the one-step API request test
 * both run here, so a request is checked, sent, bounded and refused the same way
 * whoever asked for it.
 */

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

// What a flagged answer says about itself. A trim keeps these beside the paths
// it was asked for, so "the provider did not do it" is never trimmed into what
// reads like a typo in a path.
const PROVIDER_FLAG_KEYS = [
  "ok",
  "error",
  "errors",
  "jobComplete",
  "warning",
  "response_metadata",
] as const;

/**
 * `trimmed` with the keys that carry the provider's failure flag, whole and
 * first, when the untrimmed answer is flagged. A list, or an answer with no
 * flag, comes back as it was.
 */
function withProviderFlag(json: unknown, trimmed: unknown): unknown {
  if (providerFlag(json) === null) return trimmed;
  const source = json as Record<string, unknown>;
  const flagged: Record<string, unknown> = {};
  for (const key of PROVIDER_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      flagged[key] = source[key];
    }
  }
  if (
    typeof trimmed !== "object" ||
    trimmed === null ||
    Array.isArray(trimmed)
  ) {
    return trimmed;
  }
  // The flag keys lead, and a path that kept part of one gives way to the whole.
  return { ...flagged, ...trimmed, ...flagged };
}

function isCredentialAbsence(error: unknown): boolean {
  return (
    isAgentConnectionRequiredError(error) ||
    NOT_CONFIGURED.test(error instanceof Error ? error.message : "")
  );
}

// What core throws when a page of a paged read fails. The text after the status is a preview of the provider's body, so only the status is read from it.
const PAGE_FAILED = /^fetchAllPages request failed with HTTP (\d{3})/;
const PAGE_CUT = /^fetchAllPages page \d+ was cut at the response size limit/;

function failFromCore(
  def: OperationDefinition,
  error: unknown,
  watch: ProviderWatch,
): never {
  const message = error instanceof Error ? error.message : "";
  const failedPage = PAGE_FAILED.exec(message);
  if (failedPage) {
    return failFromHttp(
      def,
      {
        status: Number(failedPage[1]),
        ok: false,
        truncated: false,
        json: undefined,
        size: 0,
        headers: {},
      },
      watch,
    );
  }
  if (PAGE_CUT.test(message)) {
    return failUnexpected(
      def,
      `${def.id} read a page that was cut at the response size limit, so its entries and next cursor are incomplete.`,
    );
  }
  if (isCredentialAbsence(error)) return credentialMissing(def);
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
  /** As core read them; only a free-form request that asked for them hands any on. */
  headers: unknown;
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
      headers: response.headers,
    },
    sentPath,
  };
}

/**
 * What core returns for a paged read: the entries of every page it read, not
 * an HTTP response. A page that failed throws instead, so this has no failure
 * status; `moreAvailable` says the page limit was hit with a next cursor left.
 */
function readPagedResponse(result: unknown): {
  response: ProviderHttpResponse | null;
  sentPath: string;
} {
  const record = result as {
    items?: unknown;
    pagesRead?: unknown;
    lastStatus?: unknown;
    truncated?: unknown;
    nextCursor?: unknown;
  } | null;
  if (
    !record ||
    !Array.isArray(record.items) ||
    typeof record.pagesRead !== "number" ||
    typeof record.lastStatus !== "number"
  ) {
    return { response: null, sentPath: "" };
  }
  return {
    response: {
      status: record.lastStatus,
      ok: true,
      truncated: false,
      size: 0,
      headers: {},
      // The facts about the paging come first: a cut keeps leading keys and trims the last, so the list gives way and these never do.
      json: {
        pagesRead: record.pagesRead,
        moreAvailable: record.truncated === true,
        nextCursor:
          typeof record.nextCursor === "string" ? record.nextCursor : null,
        items: record.items,
      },
    },
    sentPath: "",
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
      // after the call); a list that 404s is a wrong path and will not mend,
      // and neither is a path someone typed.
      retryable:
        def.effect === "read" &&
        !def.itemMapping &&
        !(
          def.implementation.type === "provider-request" &&
          def.implementation.freeForm
        ),
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
  full_url_refused: "full_url_refused",
  invalid_query: "invalid_query",
  invalid_header: "invalid_header",
  header_denied: "header_denied",
  invalid_pagination: "invalid_pagination",
  invalid_timeout: "invalid_timeout",
  incompatible_fields: "incompatible_fields",
  invalid_fields_to_keep: "invalid_fields_to_keep",
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
    limit?: number | undefined;
    prime?: boolean | undefined;
    cursor?: string | undefined;
    status: number;
    observe: ProviderObservation;
    includeStatus?: { status: number; headers: unknown } | undefined;
    fieldsMissing?: MissingReport | undefined;
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
        includeStatus: options.includeStatus,
        fieldsMissing: options.fieldsMissing,
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

export type ProviderOperationPayload = ReturnType<typeof envelope>;

/**
 * Cuts the provider's answer to the paths a step keeps, before any budget or cap
 * sees it. An answer that says the provider did not do it (`providerFlag`) keeps
 * the keys that say so. A paged read is trimmed entry by entry: its pages were concatenated
 * into `items`, which is the same as trimming each page's entries before they
 * are merged, and the paging facts stay as they were.
 */
function keepAnswerFields(
  def: OperationDefinition,
  keep: FieldsToKeep,
  json: unknown,
  paged: boolean,
): { body: unknown; missing: MissingReport | undefined } {
  if (!paged) {
    const kept = keepFields(json, keep);
    return {
      body: withProviderFlag(json, kept.body),
      missing: reportMissing(kept.missing),
    };
  }
  const facts = json as { items?: unknown } | null;
  if (!Array.isArray(facts?.items)) {
    return failUnexpected(
      def,
      `${def.id} read a paged answer with no entries to keep fields of.`,
    );
  }
  const kept = keepFields(facts.items, keep);
  return {
    body: { ...facts, items: kept.body },
    missing: reportMissing(kept.missing),
  };
}

/** The paths a catalog operation keeps of its own answer; the schema already refused a list that is not valid. */
function answerFieldsOf(def: OperationDefinition): FieldsToKeep | undefined {
  if (def.answerFields === undefined) return undefined;
  const checked = parseFieldsToKeep(def.answerFields);
  if (!checked.ok) {
    throw new TypeError(`${def.id} keeps answer fields that are not valid.`);
  }
  return checked.value;
}

export interface ProviderOperationCall {
  def: OperationDefinition;
  fields: Record<string, unknown>;
  cursor?: string | undefined;
  window?: { from: string; to: string } | undefined;
  limit?: number | undefined;
  prime?: boolean | undefined;
  identity: { userEmail: string; orgId: string; factoryId: string };
  /** The action asking, named when its result is too big to hand back. */
  caller: string;
  signal?: AbortSignal;
  /** Where the call's own observations go. Default: the run's, else the factory's. */
  tripwire?: TripwireSink;
}

interface ProviderExchange {
  /** A success the provider answered whole, with the path's placeholders filled. */
  response: ProviderHttpResponse;
  watch: ProviderWatch;
  tripwire: TripwireSink;
}

/**
 * Sends one built request and checks it: a refused or failed one throws the
 * typed failure `def`'s effect calls for (a write that may have reached the
 * provider is `_outcome_unknown`), and what comes back is a success that was
 * not cut and left no placeholder open.
 */
async function exchange(call: {
  def: OperationDefinition;
  built: BuiltProviderRequest;
  identity: ProviderOperationCall["identity"];
  signal?: AbortSignal | undefined;
  tripwire?: TripwireSink | undefined;
}): Promise<ProviderExchange> {
  const { def, built, identity } = call;
  const { userEmail, orgId, factoryId } = identity;
  const tripwire = call.tripwire ?? actionTripwire({ orgId, factoryId });
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
      ...(built.headers ? { headers: built.headers } : {}),
      ...(built.auth ? { auth: built.auth } : {}),
      ...(built.fetchAllPages ? { fetchAllPages: built.fetchAllPages } : {}),
      timeoutMs: built.timeoutMs ?? PROVIDER_CALL_TIMEOUT_MS,
      maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
      ...(call.signal ? { signal: call.signal } : {}),
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
  const { response: received, sentPath } = built.fetchAllPages
    ? readPagedResponse(result)
    : readResponse(result);
  if (!received) {
    watch.reportShape({ reason: "answer_unreadable", body: result });
    return failUnexpected(
      def,
      `${def.id} got an answer from ${def.credential.provider} that Factory could not read.`,
    );
  }
  const emptied = received.ok ? undefined : emptyRangeBody(def, received);
  const response =
    emptied === undefined ? received : { ...received, ok: true, json: emptied };
  if (!response.ok) return failFromHttp(def, response, watch);

  const pathOnly = sentPath.replace(/\?.*$/s, "").toLowerCase();
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
  return { response, watch, tripwire };
}

interface ProviderStepCall {
  /** What a failure means: a write's server error is `_outcome_unknown`, a read's is retryable. */
  def: OperationDefinition;
  request: Pick<BuiltProviderRequest, "method" | "path"> &
    Partial<Pick<BuiltProviderRequest, "query" | "body" | "openPlaceholders">>;
  identity: ProviderOperationCall["identity"];
  signal?: AbortSignal | undefined;
  tripwire?: TripwireSink | undefined;
}

/**
 * One request of a host action that composes several (a read, then the write
 * it decides). The path and body are the caller's to build and check: this
 * sends them with the connection's credential and fails as a catalog
 * operation would. `unreadable` is how the caller says the answer was not the
 * shape it needs: it is reported and fails as `unexpected_response`, or
 * `unexpected_response_outcome_unknown` when `def` writes.
 */
export async function sendProviderStep(call: ProviderStepCall): Promise<{
  status: number;
  json: unknown;
  unreadable: (reason: string) => never;
}> {
  const { response, watch } = await exchange({
    def: call.def,
    built: { query: {}, openPlaceholders: [], ...call.request },
    identity: call.identity,
    signal: call.signal,
    tripwire: call.tripwire,
  });
  return {
    status: response.status,
    json: response.json,
    unreadable: (reason) => {
      watch.reportShape({
        reason,
        status: response.status,
        body: response.json,
      });
      return failUnexpected(
        call.def,
        `${call.def.id} got an answer from ${call.def.credential.provider} that is not the shape it needs (${reason}).`,
      );
    },
  };
}

/** Builds, sends and bounds one provider operation. Throws the typed failure it ends in. */
export async function runProviderOperation(
  call: ProviderOperationCall,
): Promise<ProviderOperationPayload> {
  const { def, fields, cursor, window, limit, prime, identity } = call;
  const { orgId, factoryId } = identity;
  const built = buildOrFail(def, { fields, cursor, window });
  const { response, tripwire } = await exchange({
    def,
    built,
    identity,
    signal: call.signal,
    tripwire: call.tripwire,
  });

  const keep = built.fieldsToKeep ?? answerFieldsOf(def);
  const kept = keep
    ? keepAnswerFields(
        def,
        keep,
        response.json,
        built.fetchAllPages !== undefined,
      )
    : undefined;
  let payload: ProviderOperationPayload;
  try {
    payload = parseWithinRenderedLimit(def, kept ? kept.body : response.json, {
      scope: { orgId, factoryId },
      limit,
      prime,
      cursor,
      status: response.status,
      observe: { tripwire, status: response.status },
      // Only paths a person typed are reported: a catalog path that matched nothing is a field the provider left out.
      fieldsMissing: built.fieldsToKeep ? kept?.missing : undefined,
      ...(built.includeStatus
        ? {
            includeStatus: {
              status: response.status,
              headers: response.headers,
            },
          }
        : {}),
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
  return assertResultWithinLimit(call.caller, payload);
}

/**
 * `GET <provider> <path>` as chat's provider request is audited: the path a
 * person typed, with anything that looks like a credential masked, and the
 * query left out whole.
 */
export function auditedRequestSummary(
  provider: string,
  typedPath: unknown,
): string {
  return buildProviderApiAuditSummary({
    method: "GET",
    provider,
    path: `/${typeof typedPath === "string" ? typedPath.trim().replace(/^\/+/, "") : ""}`,
  });
}
