import { getH3App } from "../server/framework-request-handler.js";
import {
  defineEventHandler,
  setResponseStatus,
  getMethod,
  getRequestHeader,
} from "h3";
import { readBody } from "../server/h3-helpers.js";
import {
  createMCPServerForRequest,
  verifyAuth,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
  type MCPConfig,
  type MCPCallerIdentity,
  type MCPRequestMeta,
} from "./build-server.js";

// Re-export the shared MCP server builder + types so the stdio transport and
// any (future) external importer of `@agent-native/core/mcp` keep resolving
// against `./server.js` exactly as before this refactor.
export {
  createMCPServerForRequest,
  verifyAuth,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
};
export type { MCPConfig, MCPCallerIdentity, MCPRequestMeta };

// ---------------------------------------------------------------------------
// mountMCP — register MCP Streamable HTTP endpoint on H3/Nitro
// ---------------------------------------------------------------------------

/**
 * Mount an MCP remote server on an H3/Nitro app.
 *
 * Endpoint: `{routePrefix}/mcp` (default `/_agent-native/mcp`)
 *
 * Uses stateless Streamable HTTP transport — no in-memory sessions,
 * compatible with serverless deployments.
 *
 * Auth: Bearer token matching ACCESS_TOKEN/ACCESS_TOKENS or JWT via A2A_SECRET.
 * No auth required when neither is configured (dev mode).
 */
export function mountMCP(
  nitroApp: any,
  config: MCPConfig,
  routePrefix = "/_agent-native",
): void {
  getH3App(nitroApp).use(
    `${routePrefix}/mcp`,
    defineEventHandler(async (event) => {
      const pathname = event.url?.pathname || "/";
      const subpath = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
      if (subpath) {
        // Let management/status routes mounted under /_agent-native/mcp/*
        // handle their own requests instead of treating them as MCP protocol
        // traffic.
        return;
      }

      const method = getMethod(event);

      // Auth check — also extracts the caller's identity from the JWT so
      // downstream tools run inside `runWithRequestContext`.
      const authHeader = getRequestHeader(event, "authorization");
      const authResult = await verifyAuth(authHeader);
      if (!authResult.authed) {
        setResponseStatus(event, 401);
        return { error: "Unauthorized" };
      }

      // Stateless mode: only POST is meaningful
      if (method === "DELETE") {
        setResponseStatus(event, 204);
        return "";
      }

      if (method === "GET") {
        // SSE stream endpoint — not used in stateless mode but the SDK
        // handles it gracefully. Let it through for protocol compliance.
      }

      if (method !== "POST" && method !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      // Read body for POST (GET has no body)
      const body = method === "POST" ? await readBody(event) : undefined;

      // Create per-request stateless transport + server
      const { StreamableHTTPServerTransport } =
        await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      // Derive the running app's origin so relative deep links become
      // absolute URLs the external agent can open (same approach as A2A).
      const forwardedProto = getRequestHeader(event, "x-forwarded-proto");
      const host = getRequestHeader(event, "host");
      const proto =
        forwardedProto?.split(",")[0]?.trim() ||
        (host && /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
          ? "http"
          : "https");
      const origin = host ? `${proto}://${host}` : undefined;
      const targetHeader = getRequestHeader(
        event,
        "x-agent-native-open-target",
      )?.toLowerCase();
      const target =
        targetHeader === "desktop" ||
        targetHeader === "terminal" ||
        targetHeader === "browser"
          ? (targetHeader as MCPRequestMeta["target"])
          : undefined;

      const server = await createMCPServerForRequest(
        config,
        authResult.identity,
        { origin, target },
      );
      await server.connect(transport);

      // Delegate to the transport — it writes directly to the Node response.
      // MCP's HTTP transport requires Node streams; this route is Node-only.
      const nodeReq =
        (event as any).node?.req ?? (event as any).req?.runtime?.node?.req;
      const nodeRes =
        (event as any).node?.res ?? (event as any).req?.runtime?.node?.res;
      if (!nodeReq || !nodeRes) {
        setResponseStatus(event, 501);
        return { error: "MCP requires Node runtime" };
      }
      await transport.handleRequest(nodeReq, nodeRes, body);

      // Prevent H3 from double-writing the response
      (event as any)._handled = true;
    }),
  );

  if (process.env.DEBUG)
    console.log(
      `[mcp] Mounted MCP server at ${routePrefix}/mcp (${Object.keys(config.actions).length} tools${config.askAgent ? " + ask-agent" : ""})`,
    );
}
