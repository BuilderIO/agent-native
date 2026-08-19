import type { H3Event } from "h3";
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getRequestHeader,
} from "h3";

import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import { isLoopbackRequest } from "../server/auth.js";
import { getH3App } from "../server/framework-request-handler.js";
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
import {
  buildMcpOAuthChallenge,
  getMcpOAuthAudiences,
  getMcpOAuthIssuer,
  getMcpOAuthProtectedResourceMetadataUrl,
  getMcpOAuthResource,
} from "./oauth-route.js";
import {
  MCP_PUBLIC_ROUTE_PREFIX,
  MCP_ROUTE_PREFIXES,
  joinMcpRoute,
} from "./route-paths.js";

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

/**
 * Derive the request origin + the markdown deep-link target from the inbound
 * headers. Identical logic for both the Node and web paths so the absolute
 * deep-link URLs in tool results are computed the same way regardless of
 * runtime.
 */
function deriveRequestMeta(event: H3Event): MCPRequestMeta {
  const forwardedProto = getRequestHeader(event, "x-forwarded-proto");
  const host =
    getRequestHeader(event, "x-forwarded-host") ||
    getRequestHeader(event, "host");
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
  const clientName = getRequestHeader(event, "user-agent")?.trim() || undefined;
  const clientHint =
    getRequestHeader(event, "x-agent-native-mcp-client")?.trim() || undefined;
  const fullCatalogHeader = getRequestHeader(
    event,
    "x-agent-native-mcp-full-catalog",
  )?.toLowerCase();
  const fullCatalog =
    fullCatalogHeader === "1" ||
    fullCatalogHeader === "true" ||
    fullCatalogHeader === "yes";
  const inlineAppsHeader = getRequestHeader(
    event,
    "x-agent-native-mcp-inline-apps",
  )?.toLowerCase();
  const inlineAppsRequested =
    inlineAppsHeader === "1" ||
    inlineAppsHeader === "true" ||
    inlineAppsHeader === "yes";
  const basePath = getConfiguredAppBasePath();
  return {
    origin,
    ...(basePath ? { basePath } : {}),
    target,
    clientName,
    clientHint,
    ...(fullCatalog ? { fullCatalog } : {}),
    ...(inlineAppsRequested ? { inlineMcpApps: true } : {}),
  };
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

  const host =
    headers.get("x-forwarded-host") || headers.get("host") || "localhost";
  const forwardedProto = headers.get("x-forwarded-proto");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const basePath = getConfiguredAppBasePath();
  const url = `${proto}://${host}${basePath}${MCP_PUBLIC_ROUTE_PREFIX}`;

  // No body here on purpose: the JSON-RPC payload is forwarded via the
  // transport's `parsedBody` option (the same mechanism the Node transport
  // uses), so the request stream is never read twice.
  return new Request(url, { method, headers });
}

/**
 * Build an actionable JSON body for the 401 response. OAuth-capable clients
 * follow the `WWW-Authenticate` header automatically, but the JSON body is what
 * a human or a coding agent reads when a tool call comes back unauthorized — so
 * spell out the exact remediation: the `agent-native connect <url>` command and
 * the authorize/metadata URL. Keeping the legacy `error: "Unauthorized"` field
 * means existing clients that only check that field still work.
 */
function buildUnauthorizedBody(
  event: H3Event,
  routePath = MCP_PUBLIC_ROUTE_PREFIX,
): {
  error: string;
  message: string;
  authenticate: {
    command?: string;
    firstTimeCommand?: string;
    authorizeUrl?: string;
    resourceMetadataUrl?: string;
    mcpUrl?: string;
  };
} {
  const issuer = getMcpOAuthIssuer(event);
  const mcpUrl = getMcpOAuthResource(event, routePath);
  const resourceMetadataUrl = getMcpOAuthProtectedResourceMetadataUrl(
    event,
    routePath,
  );
  const command = issuer
    ? `npx -y @agent-native/core@latest reconnect ${issuer}`
    : undefined;
  const firstTimeCommand = issuer
    ? `npx @agent-native/core@latest connect ${issuer}`
    : undefined;
  const authorizeUrl = issuer
    ? `${issuer}${MCP_PUBLIC_ROUTE_PREFIX}/oauth/authorize`
    : undefined;
  const message = command
    ? `Authentication required. Run \`${command}\` to re-authenticate this ` +
      `MCP connector without reinstalling it (or, in a Claude Code host, ` +
      `run /mcp and choose Authenticate), then retry. For first-time ` +
      `setup, run \`${firstTimeCommand}\`.`
    : "Authentication required. Authenticate the MCP connector in your host, " +
      "then retry.";
  return {
    error: "Unauthorized",
    message,
    authenticate: {
      ...(command ? { command } : {}),
      ...(firstTimeCommand ? { firstTimeCommand } : {}),
      ...(authorizeUrl ? { authorizeUrl } : {}),
      ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
      ...(mcpUrl ? { mcpUrl } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// handleMcpRequest — runtime-agnostic MCP request handler
// ---------------------------------------------------------------------------

/**
 * Handle a single `{routePrefix}/mcp` request on either runtime.
 *
 * Builds one request-scoped MCP `Server` from the verified caller identity and
 * drives it through the SDK's v2 `createMcpHandler`. That entry serves native
 * 2026-07-28 envelopes and stateless 2025-era traffic from the same factory,
 * so protocol generations cannot drift apart.
 *
 * The handler is Web Standard on every runtime. H3 owns the Node response when
 * one exists, avoiding the double-write race from a transport writing directly
 * to `node.res`.
 *
 * Returns:
 *   - `undefined` when the request targets a sub-route (so management/status
 *     routes mounted under `/_agent-native/mcp/*` handle it themselves) — the
 *     h3 mount falls through to the next handler.
 *   - a Web `Response` or an auth-error object otherwise.
 */
export async function handleMcpRequest(
  event: H3Event,
  config: MCPConfig,
  routePath = MCP_PUBLIC_ROUTE_PREFIX,
): Promise<
  Response | string | { error: string } | Record<string, unknown> | undefined
> {
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
  const hasLocalOwnerHint = Boolean(ownerEmailHeader?.trim());
  const authResult = await verifyAuth(authHeader, ownerEmailHeader, {
    // A bare localhost URL is still a protected MCP resource. This lets
    // OAuth-native hosts (Kiro, Claude Code, etc.) receive the standard 401
    // challenge and open browser approval instead of silently getting the
    // sparse anonymous dev surface. The stdio proxy remains zero-config for
    // local installs because it forwards an owner hint; an explicit opt-in is
    // available for local diagnostics.
    allowDevOpen:
      isLoopbackRequest(event) &&
      isLoopbackOrigin(requestMeta.origin) &&
      (hasLocalOwnerHint || process.env.AGENT_NATIVE_MCP_DEV_OPEN === "1"),
    resourceUrl: getMcpOAuthAudiences(event),
  });
  if (!authResult.authed) {
    setResponseStatus(event, 401);
    setResponseHeader(
      event,
      "WWW-Authenticate",
      buildMcpOAuthChallenge(event, routePath),
    );
    return buildUnauthorizedBody(event, routePath);
  }

  // Read POST bodies through h3 exactly once. `createMcpHandler` accepts the
  // parsed value, so neither its modern classifier nor its legacy fallback
  // consumes the request stream a second time.
  const body = method === "POST" ? await readBody(event) : undefined;

  // Optional diagnostics for host capability negotiation. Keep disabled by
  // default because initialize payloads can include client-specific metadata.
  if (process.env.MCP_DEBUG_INIT && body) {
    const msgs = Array.isArray(body) ? body : [body];
    const init = msgs.find(
      (m): m is { params?: { capabilities?: unknown; clientInfo?: unknown } } =>
        typeof m === "object" &&
        m !== null &&
        (m as { method?: unknown }).method === "initialize",
    );
    if (init) {
      console.error(
        "[MCP_DEBUG_INIT] clientInfo=",
        JSON.stringify(init.params?.clientInfo),
        "capabilities=",
        JSON.stringify(init.params?.capabilities),
      );
    }
  }

  const serverRequestMeta: MCPRequestMeta = {
    ...requestMeta,
    fullSurface: authResult.fullSurface === true,
    inlineMcpApps:
      requestMeta.inlineMcpApps === true &&
      authResult.identity?.firstPartyMcp === true
        ? true
        : undefined,
    // When the caller minted their token with --full-catalog (catalog_scope:
    // "full" JWT claim), bypass the connector-catalog tier filter.
    ...(authResult.fullCatalog === true ? { fullCatalog: true } : {}),
  };
  const { createMcpHandler } = await import("@modelcontextprotocol/server");
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(config, authResult.identity, serverRequestMeta),
    {
      legacy: "stateless",
      // Ordinary calls stay single-body JSON unless a handler emits a related
      // message before its result. Subscription/listen remains SSE.
      responseMode: "auto",
    },
  );
  const webRequest = buildWebRequest(event, method);
  return handler.fetch(
    webRequest,
    method === "POST" ? { parsedBody: body } : undefined,
  );
}

// ---------------------------------------------------------------------------
// mountMCP — register MCP Streamable HTTP endpoint on H3/Nitro
// ---------------------------------------------------------------------------

/**
 * Mount an MCP remote server on an H3/Nitro app.
 *
 * Endpoints: `/mcp` (public) and `/_agent-native/mcp` (compatibility).
 * A custom route prefix only mounts that custom endpoint.
 *
 * Uses the v2 Web Standard per-request handler with native 2026-07-28 serving
 * and stateless 2025-era fallback. It carries no in-memory protocol session
 * across invocations and works unchanged on Node, Nitro/Netlify web runtimes,
 * Cloudflare, Deno, and Bun.
 *
 * Auth: Bearer token matching ACCESS_TOKEN/ACCESS_TOKENS or JWT via A2A_SECRET.
 * No auth required when neither is configured (dev mode).
 */
export function mountMCP(
  nitroApp: any,
  config: MCPConfig,
  routePrefix = "/_agent-native",
): void {
  const routePaths =
    routePrefix === "/_agent-native"
      ? [...MCP_ROUTE_PREFIXES]
      : [joinMcpRoute(routePrefix, "/mcp")];

  for (const routePath of routePaths) {
    getH3App(nitroApp).use(
      routePath,
      defineEventHandler(async (event) => {
        return handleMcpRequest(event as H3Event, config, routePath);
      }),
    );
  }

  if (process.env.DEBUG)
    console.log(
      `[mcp] Mounted MCP server at ${routePaths.join(" and ")} (${Object.keys(config.actions).length} tools${config.askAgent ? " + ask-agent" : ""})`,
    );
}
