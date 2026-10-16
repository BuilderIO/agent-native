import { getAppConfig } from "../app-config/store.js";
import { trackMcpInitialize } from "./analytics.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";

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

function trackInitializeRequest(
  body: unknown,
  config: MCPConfig,
  options: MCPFetchHandlerOptions,
): void {
  const initializeRequest = findInitializeRequest(body);
  if (!initializeRequest) return;

  if (getAppConfig().observability.mcpDebugInitialize) {
    console.error(
      "[MCP_DEBUG_INIT] clientInfo=",
      JSON.stringify(initializeRequest.params?.clientInfo),
      "capabilities=",
      JSON.stringify(initializeRequest.params?.capabilities),
    );
  }

  const clientInfo = initializeRequest.params?.clientInfo;
  const protocolVersion = initializeRequest.params?.protocolVersion;
  trackMcpInitialize({
    source: "http",
    serverName: config.name,
    serverVersion: config.version ?? "1.0.0",
    ...(config.appId ? { appId: config.appId } : {}),
    ...(typeof clientInfo?.name === "string"
      ? { clientName: clientInfo.name }
      : {}),
    ...(typeof clientInfo?.version === "string"
      ? { clientVersion: clientInfo.version }
      : {}),
    ...(options.requestMeta.clientName
      ? { clientUserAgent: options.requestMeta.clientName }
      : {}),
    ...(typeof protocolVersion === "string" ? { protocolVersion } : {}),
    ...(options.identity?.userEmail
      ? { userId: options.identity.userEmail }
      : {}),
  });
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
  /** Identity established by the host's existing authentication policy. */
  identity?: MCPCallerIdentity;
  /** Request metadata established by the host after authentication. */
  requestMeta: MCPRequestMeta;
  /** Reuse a body already parsed by a framework adapter. */
  parsedBody?: unknown;
}

/**
 * Execute an authenticated MCP request using only Web Platform request and
 * response primitives.
 *
 * Authentication deliberately remains outside this adapter: hosts must apply
 * their existing policy first and pass only the resulting identity and request
 * metadata. This keeps transport portability from creating a second auth path.
 */
export async function handleMcpFetchRequest(
  request: Request,
  config: MCPConfig,
  options: MCPFetchHandlerOptions,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const body = method === "POST" ? options.parsedBody : undefined;
  const hasParsedBody = body !== undefined;
  const { createMcpHandler, isJsonContentType } =
    await import("@modelcontextprotocol/server");
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(config, options.identity, options.requestMeta),
    { legacy: "stateless", responseMode: "auto" },
  );

  const initializeBody =
    !hasParsedBody &&
    method === "POST" &&
    isJsonContentType(request.headers.get("content-type"))
      ? readJsonBodyForInitialize(request)
      : undefined;

  if (hasParsedBody) trackInitializeRequest(body, config, options);

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
  trackInitializeRequest(observedBody, config, options);
  if (!result.ok) throw result.error;
  return result.response;
}
