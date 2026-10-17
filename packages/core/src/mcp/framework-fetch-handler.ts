import { getAppConfig } from "../app-config/store.js";
import { trackMcpInitialize } from "./analytics.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";
import {
  handleMcpFetchRequest as handleWebMcpFetchRequest,
  type MCPInitializeRequest,
} from "./fetch-handler.js";

export interface MCPFetchHandlerOptions {
  /** Identity established by the host's existing authentication policy. */
  identity?: MCPCallerIdentity;
  /** Request metadata established by the host after authentication. */
  requestMeta: MCPRequestMeta;
  /** Reuse a body already parsed by a framework adapter. */
  parsedBody?: unknown;
}

function trackInitializeRequest(
  request: MCPInitializeRequest,
  config: MCPConfig,
  options: MCPFetchHandlerOptions,
): void {
  if (getAppConfig().observability.mcpDebugInitialize) {
    console.error(
      "[MCP_DEBUG_INIT] clientInfo=",
      JSON.stringify(request.params?.clientInfo),
      "capabilities=",
      JSON.stringify(request.params?.capabilities),
    );
  }

  const clientInfo = request.params?.clientInfo;
  const protocolVersion = request.params?.protocolVersion;
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

/** Execute the framework's authenticated MCP server through a Fetch request. */
export async function handleMcpFetchRequest(
  request: Request,
  config: MCPConfig,
  options: MCPFetchHandlerOptions,
): Promise<Response> {
  return handleWebMcpFetchRequest(request, {
    createServer: () =>
      createMCPServerForRequest(config, options.identity, options.requestMeta),
    ...(options.parsedBody === undefined
      ? {}
      : { parsedBody: options.parsedBody }),
    onInitialize: (initializeRequest) =>
      trackInitializeRequest(initializeRequest, config, options),
  });
}
