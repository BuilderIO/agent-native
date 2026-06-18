import { resolveBuilderCredential } from "@agent-native/core/server";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

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
type NodeRequestLike = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

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

async function executeNodeRequest(args: {
  url: URL;
  method: "POST" | "PATCH";
  headers: Record<string, string>;
  body: string;
  requestImpl?: NodeRequestLike;
}): Promise<BuilderCmsWriteResult> {
  const requestImpl =
    args.requestImpl ??
    (args.url.protocol === "http:" ? httpRequest : httpsRequest);

  return await new Promise((resolve, reject) => {
    const request = requestImpl(
      args.url,
      {
        method: args.method,
        headers: args.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          resolve(
            buildWriteResult({
              ok: status >= 200 && status < 300,
              status,
              responseText: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.write(args.body);
    request.end();
  });
}

export async function executeBuilderCmsWrite(args: {
  request: BuilderCmsWriteRequest;
  fetchImpl?: FetchLike;
  nodeRequestImpl?: NodeRequestLike;
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

  try {
    const response = await (args.fetchImpl ?? fetch)(url, {
      method: args.request.method,
      headers,
      body,
    });
    return buildWriteResult({
      ok: response.ok,
      status: response.status,
      responseText: await response.text(),
    });
  } catch (error) {
    if (
      args.request.method === "PATCH" &&
      (args.nodeRequestImpl || !args.fetchImpl)
    ) {
      try {
        return await executeNodeRequest({
          url,
          method: args.request.method,
          headers,
          body,
          requestImpl: args.nodeRequestImpl,
        });
      } catch {
        // Return the original fetch failure below; it is usually more specific.
      }
    }

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
