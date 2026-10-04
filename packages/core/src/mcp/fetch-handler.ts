import { getAppConfig } from "../app-config/store.js";
import { trackMcpInitialize } from "./analytics.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";

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
  const initializeRequest = body
    ? (Array.isArray(body) ? body : [body]).find(
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
      )
    : undefined;

  if (getAppConfig().observability.mcpDebugInitialize && initializeRequest) {
    console.error(
      "[MCP_DEBUG_INIT] clientInfo=",
      JSON.stringify(initializeRequest.params?.clientInfo),
      "capabilities=",
      JSON.stringify(initializeRequest.params?.capabilities),
    );
  }

  if (initializeRequest) {
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

  const { createMcpHandler } = await import("@modelcontextprotocol/server");
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(config, options.identity, options.requestMeta),
    { legacy: "stateless", responseMode: "auto" },
  );
  return handler.fetch(
    request,
    hasParsedBody ? { parsedBody: body } : undefined,
  );
}
