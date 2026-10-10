import { fail, isActionContractError } from "@agent-native/core/action";
import {
  BUILDER_CONTENT_WRITE_SCOPE,
  BUILDER_OAUTH_RESOURCE,
  resolveBuilderLegacyRequestAuthorization,
  resolveBuilderRequestAuthorization,
  type BuilderRequestAuthorization,
} from "@agent-native/core/server";

export interface BuilderCmsWriteRequest {
  method: "POST" | "PATCH";
  path: string;
  query?: Record<string, string>;
  body: unknown;
}

export interface BuilderCmsWriteResult {
  ok: boolean;
  status: number;
  entryId?: string;
  responseBody: unknown;
  error?: string;
  ambiguity?: "timeout" | "transport" | "provider";
}

export const DEFAULT_BUILDER_CMS_WRITE_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

function builderWriteApiHost(source: BuilderRequestAuthorization["source"]) {
  // An OAuth bearer stays on its Builder API resource; only the explicit
  // management-host override may redirect it.
  const host =
    source === "oauth"
      ? (process.env.BUILDER_CMS_API_HOST ?? BUILDER_OAUTH_RESOURCE)
      : (process.env.BUILDER_CONTENT_API_HOST ??
        process.env.BUILDER_CMS_API_HOST ??
        "https://builder.io");
  return host.replace(/\/+$/, "");
}

const BUILDER_WRITE_LEGACY_CREDENTIAL_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_CMS_PRIVATE_KEY",
] as const;

async function readBuilderWriteAuthorization(sourceBound: boolean) {
  try {
    return await resolveBuilderRequestAuthorization({
      oauthResource: "general",
      requiredScope: BUILDER_CONTENT_WRITE_SCOPE,
      legacyCredentialKeys: BUILDER_WRITE_LEGACY_CREDENTIAL_KEYS,
    });
  } catch (error) {
    // The shared resolver throws instead of falling back when a grant predates
    // builder:content:write. A caller with no Source binding wrote with the
    // deploy keys before OAuth, so it keeps that path until re-authorizing.
    if (
      sourceBound ||
      !isActionContractError(error) ||
      error.errorCode !== "builder_oauth_reauthorization_required"
    ) {
      throw error;
    }
    const legacy = await resolveBuilderLegacyRequestAuthorization(
      BUILDER_WRITE_LEGACY_CREDENTIAL_KEYS,
    );
    if (!legacy) throw error;
    return legacy;
  }
}

function assertBuilderWriteSourceBinding(
  authorization: Awaited<ReturnType<typeof readBuilderWriteAuthorization>>,
  expectedSourceSpace: string | null | undefined,
  expectedSourceConnectionId: string | null | undefined,
  required: boolean,
) {
  if (
    required &&
    (authorization?.source !== "oauth" ||
      authorization.oauthResource !== "general")
  ) {
    fail(
      "This Builder source's OAuth connection is unavailable. Reconnect the source before writing.",
      { errorCode: "builder_connection_required", statusCode: 412 },
    );
  }
  if (authorization?.source !== "oauth") return;
  if (!required && !expectedSourceSpace && !expectedSourceConnectionId) return;
  if (!expectedSourceSpace || !expectedSourceConnectionId) {
    fail(
      "This Builder source is not bound to its connected space. Refresh the source before writing.",
      { errorCode: "builder_source_unbound", statusCode: 409 },
    );
  }
  if (authorization.oauthSelectedPublicKey !== expectedSourceSpace) {
    fail(
      "The connected Builder space does not match this Content source. Reconnect the source's Builder space before writing.",
      { errorCode: "builder_source_space_mismatch", statusCode: 409 },
    );
  }
  if (authorization.oauthConnectionId !== expectedSourceConnectionId) {
    fail(
      "The connected Builder credential does not match this Content source. Reconnect the source before writing.",
      { errorCode: "builder_source_connection_mismatch", statusCode: 409 },
    );
  }
}

function parseResponseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function builderValidationMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidates = [record.message, record.error, record.detail];
  if (Array.isArray(record.errors)) {
    for (const error of record.errors) {
      if (typeof error === "string") candidates.push(error);
      else if (error && typeof error === "object" && !Array.isArray(error)) {
        candidates.push((error as Record<string, unknown>).message);
      }
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const message = candidate.replace(/\s+/g, " ").trim();
    if (
      message.length > 0 &&
      message.length <= 240 &&
      /\b(required|must|invalid|validation|at least|at most|minimum|maximum|too short|too long)\b/i.test(
        message,
      ) &&
      !/(?:https?:\/\/|bearer\s+|api[_ -]?key|token|secret|password)/i.test(
        message,
      )
    ) {
      return message;
    }
  }
  return undefined;
}

function stringRecordValue(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractBuilderCmsWriteEntryId(
  value: unknown,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const direct = stringRecordValue(record, ["id", "@id", "uuid", "entryId"]);
  if (direct) return direct;

  for (const key of ["entry", "result", "content", "data"]) {
    const nested = record[key];
    const nestedId = extractBuilderCmsWriteEntryId(nested);
    if (nestedId) return nestedId;
  }

  return undefined;
}

function buildWriteResult(args: {
  ok: boolean;
  status: number;
  responseText: string;
}): BuilderCmsWriteResult {
  const responseBody = parseResponseBody(args.responseText);
  const entryId = extractBuilderCmsWriteEntryId(responseBody);
  const validationMessage =
    !args.ok && (args.status === 400 || args.status === 422)
      ? builderValidationMessage(responseBody)
      : undefined;
  const providerOutcomeUnknown = !args.ok && args.status >= 500;
  return {
    ok: args.ok,
    status: args.status,
    entryId: providerOutcomeUnknown ? undefined : entryId,
    responseBody: providerOutcomeUnknown ? null : responseBody,
    ambiguity: providerOutcomeUnknown ? "provider" : undefined,
    error: args.ok
      ? undefined
      : validationMessage
        ? `Builder validation failed: ${validationMessage}`
        : providerOutcomeUnknown
          ? `Builder returned HTTP ${args.status} after the write was dispatched; remote outcome is unknown.`
          : `Builder write request failed with HTTP ${args.status}.`,
  };
}

export async function executeBuilderCmsWrite(args: {
  request: BuilderCmsWriteRequest;
  expectedSourceSpace?: string | null;
  expectedSourceConnectionId?: string | null;
  requireSourceBinding?: boolean;
  fetchImpl?: FetchLike;
  /** @deprecated Never used: retrying another transport after dispatch is unsafe. */
  nodeRequestImpl?: unknown;
  timeoutMs?: number;
}): Promise<BuilderCmsWriteResult> {
  const authorization = await readBuilderWriteAuthorization(
    args.requireSourceBinding === true ||
      Boolean(args.expectedSourceSpace || args.expectedSourceConnectionId),
  );
  if (!authorization) {
    return {
      ok: false,
      status: 0,
      responseBody: null,
      error: "Builder write access is not connected.",
    };
  }
  assertBuilderWriteSourceBinding(
    authorization,
    args.expectedSourceSpace,
    args.expectedSourceConnectionId,
    args.requireSourceBinding === true,
  );

  const url = new URL(
    args.request.path,
    builderWriteApiHost(authorization.source),
  );
  for (const [key, value] of Object.entries(args.request.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const body = JSON.stringify(args.request.body);
  const headers = {
    accept: "application/json",
    authorization: authorization.authorization,
    "content-type": "application/json",
  };

  const controller = new AbortController();
  const timeoutMs = Math.max(
    1,
    args.timeoutMs ?? DEFAULT_BUILDER_CMS_WRITE_TIMEOUT_MS,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (args.fetchImpl ?? fetch)(url, {
      method: args.request.method,
      headers,
      body,
      signal: controller.signal,
    });
    return buildWriteResult({
      ok: response.ok,
      status: response.status,
      responseText: await response.text(),
    });
  } catch {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      status: 0,
      responseBody: null,
      ambiguity: timedOut ? "timeout" : "transport",
      error: timedOut
        ? `Builder write timed out after ${timeoutMs}ms; remote outcome is unknown.`
        : "Builder write transport failed after dispatch; remote outcome is unknown.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
