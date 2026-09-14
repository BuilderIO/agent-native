import {
  BUILDER_CONTENT_WRITE_SCOPE,
  BUILDER_OAUTH_RESOURCE,
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
  return (
    process.env.BUILDER_CONTENT_API_HOST ??
    process.env.BUILDER_CMS_API_HOST ??
    (source === "oauth" ? BUILDER_OAUTH_RESOURCE : "https://builder.io")
  ).replace(/\/+$/, "");
}

async function readBuilderWriteAuthorization() {
  return resolveBuilderRequestAuthorization({
    oauthResource: "general",
    requiredScope: BUILDER_CONTENT_WRITE_SCOPE,
    legacyCredentialKeys: ["BUILDER_PRIVATE_KEY", "BUILDER_CMS_PRIVATE_KEY"],
  });
}

function assertBuilderWriteSourceBinding(
  authorization: Awaited<ReturnType<typeof readBuilderWriteAuthorization>>,
  expectedSourceSpace: string | null | undefined,
  expectedSourceConnectionId: string | null | undefined,
  required: boolean,
) {
  if (
    expectedSourceSpace &&
    expectedSourceConnectionId &&
    (authorization?.source !== "oauth" ||
      authorization.oauthResource !== "general")
  ) {
    throw new Error(
      "This Builder source's OAuth connection is unavailable. Reconnect the source before writing.",
    );
  }
  if (authorization?.source !== "oauth") return;
  if (!required && !expectedSourceSpace && !expectedSourceConnectionId) return;
  if (!expectedSourceSpace || !expectedSourceConnectionId) {
    throw new Error(
      "This Builder source is not bound to its connected space. Refresh the source before writing.",
    );
  }
  if (authorization.oauthSelectedPublicKey !== expectedSourceSpace) {
    throw new Error(
      "The connected Builder space does not match this Content source. Reconnect the source's Builder space before writing.",
    );
  }
  if (authorization.oauthConnectionId !== expectedSourceConnectionId) {
    throw new Error(
      "The connected Builder credential does not match this Content source. Reconnect the source before writing.",
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
  const authorization = await readBuilderWriteAuthorization();
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
