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

export async function executeBuilderCmsWrite(args: {
  request: BuilderCmsWriteRequest;
  fetchImpl?: FetchLike;
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

  try {
    const response = await (args.fetchImpl ?? fetch)(url, {
      method: args.request.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${privateKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.request.body),
    });
    const responseBody = parseResponseBody(await response.text());
    const entryId = extractBuilderCmsWriteEntryId(responseBody);

    return {
      ok: response.ok,
      status: response.status,
      entryId,
      responseBody,
      error: response.ok
        ? undefined
        : `Builder write request failed with HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      responseBody: null,
      error:
        error instanceof Error
          ? `Builder write request failed: ${error.message}`
          : "Builder write request failed.",
    };
  }
}
