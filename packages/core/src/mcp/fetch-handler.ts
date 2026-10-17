import type { createMcpHandler } from "@modelcontextprotocol/server";

type MCPServerFactory = Parameters<typeof createMcpHandler>[0];

const MAX_INITIALIZE_TELEMETRY_BODY_BYTES = 64 * 1024;

function findInitializeRequest(body: unknown) {
  return (Array.isArray(body) ? body : [body]).find(
    (
      message,
    ): message is {
      params?: {
        capabilities?: unknown;
        clientInfo?: { name?: unknown; version?: unknown };
        protocolVersion?: unknown;
      };
    } =>
      typeof message === "object" &&
      message !== null &&
      (message as { method?: unknown }).method === "initialize",
  );
}

async function readJsonBodyForInitialize(request: Request): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = request.clone().body?.getReader();
    if (!reader) return undefined;

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_INITIALIZE_TELEMETRY_BODY_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // The MCP transport still owns body validation and its protocol response.
    return undefined;
  } finally {
    reader?.releaseLock();
  }
}

async function cancelUnreadBody(request: Request): Promise<void> {
  if (request.bodyUsed || !request.body) return;
  try {
    await request.body.cancel();
  } catch {
    // A transport that already locked the body owns its remaining cleanup.
  }
}

export interface MCPFetchHandlerOptions {
  /** Create the transport's MCP server without coupling it to a host runtime. */
  createServer: MCPServerFactory;
  /** Reuse a body already parsed by a framework adapter. */
  parsedBody?: unknown;
  /** Observe an initialize request without coupling transport to telemetry. */
  onInitialize?: (request: MCPInitializeRequest) => void;
}

export interface MCPInitializeRequest {
  params?: {
    capabilities?: unknown;
    clientInfo?: { name?: unknown; version?: unknown };
    protocolVersion?: unknown;
  };
}

/**
 * Execute an authenticated MCP request using only Web Platform request and
 * response primitives.
 *
 * Authentication and server construction remain with the host, which supplies
 * a factory only after applying its existing request policy.
 */
export async function handleMcpFetchRequest(
  request: Request,
  options: MCPFetchHandlerOptions,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const body = method === "POST" ? options.parsedBody : undefined;
  const hasParsedBody = body !== undefined;
  const { createMcpHandler, isJsonContentType } =
    await import("@modelcontextprotocol/server");
  const handler = createMcpHandler(options.createServer, {
    legacy: "stateless",
    responseMode: "auto",
  });

  const initializeBody =
    !hasParsedBody &&
    method === "POST" &&
    isJsonContentType(request.headers.get("content-type"))
      ? readJsonBodyForInitialize(request)
      : undefined;

  if (hasParsedBody) {
    const initializeRequest = findInitializeRequest(body);
    if (initializeRequest) options.onInitialize?.(initializeRequest);
  }

  const responsePromise = handler.fetch(
    request,
    hasParsedBody ? { parsedBody: body } : undefined,
  );
  if (!initializeBody) return responsePromise;

  const responseResult = responsePromise.then(
    (response) => ({ ok: true as const, response }),
    (error) => ({ ok: false as const, error }),
  );
  const [result, observedBody] = await Promise.all([
    responseResult,
    initializeBody,
  ]);
  await cancelUnreadBody(request);
  const initializeRequest = findInitializeRequest(observedBody);
  if (initializeRequest) options.onInitialize?.(initializeRequest);
  if (!result.ok) throw result.error;
  return result.response;
}
