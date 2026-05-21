import type { H3Event } from "h3";
import { getH3App } from "../server/framework-request-handler.js";
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getRequestHeader,
} from "h3";
import { readBody } from "../server/h3-helpers.js";
import { isLoopbackRequest } from "../server/auth.js";
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
import { buildMcpOAuthChallenge, getMcpOAuthResource } from "./oauth-route.js";

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
// Runtime detection — Node fast-path vs. web-standard fallback
// ---------------------------------------------------------------------------

/**
 * Resolve the underlying Node `http` req/res pair if (and only if) we're
 * running on a real Node HTTP server (local dev, `node` Nitro preset). On the
 * web-standard runtime (Nitro 3 / Netlify web runtime, Cloudflare, Deno, Bun)
 * BOTH of these are undefined — that's the signal to take the web fallback
 * instead of returning 501.
 */
function getNodeReqRes(event: H3Event): {
  nodeReq: any | undefined;
  nodeRes: any | undefined;
} {
  const e = event as any;
  const nodeReq = e.node?.req ?? e.req?.runtime?.node?.req;
  const nodeRes = e.node?.res ?? e.req?.runtime?.node?.res;
  return { nodeReq, nodeRes };
}

/**
 * Derive the request origin + the markdown deep-link target from the inbound
 * headers. Identical logic for both the Node and web paths so the absolute
 * deep-link URLs in tool results are computed the same way regardless of
 * runtime.
 */
function deriveRequestMeta(event: H3Event): MCPRequestMeta {
  const forwardedProto = getRequestHeader(event, "x-forwarded-proto");
  const host = getRequestHeader(event, "host");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    (host && /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
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
  return { origin, target };
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

/**
 * Reconstruct a Web Standard `Request` for the web-standard MCP transport.
 *
 * On the web runtime h3 v2 exposes the real web `Request` as `event.req`; we
 * prefer it (its `method` / `headers` are exactly what the client sent). But
 * the framework middleware rewrites `event.req.url` when it strips a mount
 * prefix, and the transport reads `req.method` + `req.headers` (never the
 * body — we pass that via `parsedBody`), so we always synthesize a clean
 * `Request` with the verified method + a fresh `Headers` copy. The URL is
 * cosmetic for the SDK (it only does `new URL(req.url)` for `requestInfo`),
 * so a best-effort absolute URL derived from the inbound host is sufficient
 * and never throws.
 */
function buildWebRequest(event: H3Event, method: string): Request {
  const src = (event as any).req as Request | undefined;

  const headers = new Headers();
  if (src?.headers && typeof src.headers.forEach === "function") {
    src.headers.forEach((value, key) => headers.set(key, value));
  } else {
    const rawHeaders = (event as any).node?.req?.headers as
      | Record<string, string | string[] | undefined>
      | undefined;
    if (rawHeaders) {
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (value == null) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }
  }

  // The SDK requires Accept + Content-Type to advertise both JSON and SSE on
  // a POST. Real MCP clients (Claude Code, `agent-native connect`) always
  // send these; we never inject/alter them — if they're absent the SDK
  // returns its spec-mandated 406/415, identical to the Node path.

  const host = headers.get("host") || "localhost";
  const forwardedProto = headers.get("x-forwarded-proto");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  let url = `${proto}://${host}/_agent-native/mcp`;
  try {
    if (src?.url) url = new URL(src.url).href;
  } catch {
    // keep the synthesized URL
  }

  // No body here on purpose: the JSON-RPC payload is forwarded via the
  // transport's `parsedBody` option (the same mechanism the Node transport
  // uses), so the request stream is never read twice.
  return new Request(url, { method, headers });
}

// ---------------------------------------------------------------------------
// handleMcpRequest — runtime-agnostic MCP request handler
// ---------------------------------------------------------------------------

/**
 * Handle a single `{routePrefix}/mcp` request on either runtime.
 *
 * - **Node fast-path** (real Node HTTP server): unchanged — delegate to the
 *   SDK's `StreamableHTTPServerTransport.handleRequest(nodeReq, nodeRes,
 *   body)`, which writes directly to the Node response (full protocol incl.
 *   SSE).
 * - **Web-standard fallback** (Nitro 3 / Netlify web runtime, Cloudflare,
 *   Deno, Bun — where there is no Node req/res): build the SAME MCP `Server`
 *   from the SAME config + identity, drive it through the SDK's
 *   `WebStandardStreamableHTTPServerTransport` (which the Node transport is
 *   itself just a thin wrapper around), and return the resulting Web
 *   `Response` as a normal h3 return value.
 *
 * Auth, the `runWithRequestContext` identity wrap, the deep-link `_meta` /
 * markdown append, `requestMeta` origin/target derivation and the stateless
 * semantics are IDENTICAL on both paths because both build the same server
 * via `createMCPServerForRequest` and both transports funnel into the same
 * `WebStandardStreamableHTTPServerTransport.handleRequest(webRequest, {
 * parsedBody })` with the same options.
 *
 * Returns:
 *   - `undefined` when the request targets a sub-route (so management/status
 *     routes mounted under `/_agent-native/mcp/*` handle it themselves) — the
 *     h3 mount falls through to the next handler.
 *   - a Web `Response` (web fallback) or a string/object (Node path /
 *     auth-error path) otherwise. The Node path also sets `_handled` so h3
 *     doesn't double-write.
 */
export async function handleMcpRequest(
  event: H3Event,
  config: MCPConfig,
): Promise<Response | string | { error: string } | undefined> {
  const pathname = event.url?.pathname || "/";
  const subpath = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (subpath) {
    // Let management/status routes mounted under /_agent-native/mcp/* handle
    // their own requests instead of treating them as MCP protocol traffic.
    return undefined;
  }

  const method = getMethod(event);

  // Auth check — extracts the caller's identity from the JWT (`sub`), or, on
  // the static-token / dev-open path, from the forwarded
  // `X-Agent-Native-Owner-Email` hint the stdio proxy sends (the
  // `agent-native mcp install` flow). Without this the install flow would run
  // every tool unscoped (userEmail === undefined).
  const authHeader = getRequestHeader(event, "authorization");
  const ownerEmailHeader = getRequestHeader(
    event,
    "x-agent-native-owner-email",
  );
  // Gate header-only dev-open on the REAL socket peer, never a parsed
  // `Host` header (client-controlled — an attacker could send
  // `Host: localhost`). A deployed app missing A2A_SECRET / ACCESS_TOKEN
  // must fail closed rather than trust a spoofable owner-email header that
  // `fullSurface` would otherwise escalate to the full mutating surface.
  const requestMeta = deriveRequestMeta(event);
  const authResult = await verifyAuth(authHeader, ownerEmailHeader, {
    allowDevOpen:
      isLoopbackRequest(event) && isLoopbackOrigin(requestMeta.origin),
    resourceUrl: getMcpOAuthResource(event),
  });
  if (!authResult.authed) {
    setResponseStatus(event, 401);
    setResponseHeader(event, "WWW-Authenticate", buildMcpOAuthChallenge(event));
    return { error: "Unauthorized" };
  }

  // Stateless mode: only POST is meaningful
  if (method === "DELETE") {
    setResponseStatus(event, 204);
    return "";
  }

  if (method !== "POST" && method !== "GET") {
    setResponseStatus(event, 405);
    return { error: "Method not allowed" };
  }

  // Read body for POST (GET has no body). Read it via the h3 helper exactly
  // once; both transports accept it as a pre-parsed body so the request
  // stream is never consumed twice.
  const body = method === "POST" ? await readBody(event) : undefined;

  // Per-request stateless transport + server. Both runtimes build the SAME
  // server from the SAME config + verified identity + request meta, so
  // tools/list, tools/call, and the deep-link `_meta` are identical. A
  // connected real caller (connect-minted token / `mcp install` /
  // ACCESS_TOKEN / production) gets the full action surface even in local
  // dev; unauthenticated dev probes stay sparse. See `external-agents` skill.
  const server = await createMCPServerForRequest(config, authResult.identity, {
    ...requestMeta,
    fullSurface: authResult.fullSurface === true,
  });

  const { nodeReq, nodeRes } = getNodeReqRes(event);

  if (nodeReq && nodeRes) {
    // ---- Node fast-path (UNCHANGED behavior) --------------------------------
    const { StreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await server.connect(transport);
    try {
      // The SDK transport writes directly to the Node response. Node-only by
      // construction; we only reach here when real Node req/res exist.
      await transport.handleRequest(nodeReq, nodeRes, body);
    } catch (err: any) {
      // The SDK transport writes directly to the Node response. If the socket
      // is already closed/ended (client disconnected, or the host stream
      // layer also flushed), Node throws ERR_STREAM_WRITE_AFTER_END *after*
      // the MCP payload was already delivered correctly. Swallow that benign
      // post-flush write so an external agent disconnecting mid-stream can
      // never take down the server process; rethrow anything else.
      if (err?.code !== "ERR_STREAM_WRITE_AFTER_END") throw err;
      if (process.env.DEBUG)
        console.log(
          "[mcp] ignored post-flush ERR_STREAM_WRITE_AFTER_END (client disconnected)",
        );
    }
    // Prevent H3 from double-writing the response
    (event as any)._handled = true;
    return undefined;
  }

  // ---- Web-standard fallback (Nitro 3 / Netlify web runtime, CF, Deno,
  // Bun) ---------------------------------------------------------------------
  //
  // `StreamableHTTPServerTransport` is itself just a thin wrapper that
  // converts the Node req/res to a web Request/Response and delegates to
  // `WebStandardStreamableHTTPServerTransport.handleRequest(webRequest, {
  // parsedBody })`. Using the web transport directly with the SAME options +
  // the same pre-read `parsedBody` produces byte-identical protocol output
  // (including the deep-link `_meta` built inside createMCPServerForRequest),
  // and works on every web runtime because it returns a Web `Response`
  // (JSON for request/response, or an SSE `ReadableStream` body which h3
  // streams natively).
  const { WebStandardStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — same as the Node path
  });
  await server.connect(transport);
  const webRequest = buildWebRequest(event, method);
  // `parsedBody: undefined` would make the SDK try to read `req.json()`; our
  // synthesized request has no body, so only pass the option for POST (where
  // we actually have a parsed body). For GET the transport reads no body.
  const response = await transport.handleRequest(
    webRequest,
    method === "POST" ? { parsedBody: body } : undefined,
  );
  return response;
}

// ---------------------------------------------------------------------------
// mountMCP — register MCP Streamable HTTP endpoint on H3/Nitro
// ---------------------------------------------------------------------------

/**
 * Mount an MCP remote server on an H3/Nitro app.
 *
 * Endpoint: `{routePrefix}/mcp` (default `/_agent-native/mcp`)
 *
 * Uses stateless Streamable HTTP transport — no in-memory sessions,
 * compatible with serverless deployments. Runtime-agnostic: a real Node
 * server uses the SDK's Node transport; the web-standard runtime (Nitro 3 /
 * Netlify web runtime, Cloudflare, Deno, Bun) uses the SDK's web-standard
 * transport. Both build the same server and produce identical JSON-RPC
 * output.
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
      return handleMcpRequest(event as H3Event, config);
    }),
  );

  if (process.env.DEBUG)
    console.log(
      `[mcp] Mounted MCP server at ${routePrefix}/mcp (${Object.keys(config.actions).length} tools${config.askAgent ? " + ask-agent" : ""})`,
    );
}
