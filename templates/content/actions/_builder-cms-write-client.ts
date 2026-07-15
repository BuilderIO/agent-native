import { resolveBuilderCredential } from "@agent-native/core/server";

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
  ambiguity?: "timeout" | "transport";
}

type FetchLike = typeof fetch;

function builderWriteApiHost() {
  return (
    process.env.BUILDER_CONTENT_API_HOST ??
    process.env.BUILDER_CMS_API_HOST ??
    "https://builder.io"
  ).replace(/\/+$/, "");
}

async function readBuilderPrivateKey() {
  return (
    (await resolveBuilderCredential("BUILDER_PRIVATE_KEY")) ??
    (await resolveBuilderCredential("BUILDER_CMS_PRIVATE_KEY"))
  );
}

function parseResponseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
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
  return {
    ok: args.ok,
    status: args.status,
    entryId,
    responseBody,
    error: args.ok
      ? undefined
      : `Builder write request failed with HTTP ${args.status}.`,
  };
}

export async function executeBuilderCmsWrite(args: {
  request: BuilderCmsWriteRequest;
  fetchImpl?: FetchLike;
  /** @deprecated Never used: retrying another transport after dispatch is unsafe. */
  nodeRequestImpl?: unknown;
  timeoutMs?: number;
}): Promise<BuilderCmsWriteResult> {
  const privateKey = await readBuilderPrivateKey();
  if (!privateKey) {
    return {
      ok: false,
      status: 0,
      responseBody: null,
      error: "Builder private key is not configured.",
    };
  }

  const url = new URL(args.request.path, builderWriteApiHost());
  for (const [key, value] of Object.entries(args.request.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const body = JSON.stringify(args.request.body);
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${privateKey}`,
    "content-type": "application/json",
  };

  const controller = new AbortController();
  const timeoutMs = Math.max(1, args.timeoutMs ?? 15_000);
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
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      status: 0,
      responseBody: null,
      ambiguity: timedOut ? "timeout" : "transport",
      error: timedOut
        ? `Builder write timed out after ${timeoutMs}ms; remote outcome is unknown.`
        : error instanceof Error
          ? `Builder write transport failed after dispatch; remote outcome is unknown: ${error.message}`
          : "Builder write transport failed after dispatch; remote outcome is unknown.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
