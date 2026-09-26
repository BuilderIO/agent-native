import type { H3Event } from "h3";
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getRequestHeader,
} from "h3";

import { getAppConfig } from "../app-config/store.js";
import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import { isLoopbackRequest } from "../server/auth.js";
import { getH3App } from "../server/framework-request-handler.js";
import { readBody } from "../server/h3-helpers.js";
import { trackMcpInitialize } from "./analytics.js";
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

export {
  createMCPServerForRequest,
  verifyAuth,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
};
export type { MCPConfig, MCPCallerIdentity, MCPRequestMeta };

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
  const mcpRetryToken =
    getRequestHeader(event, "x-agent-native-mcp-retry-token")?.trim() ||
    undefined;
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
    transport: "http",
    clientName,
    clientHint,
    ...(mcpRetryToken ? { mcpRetryToken } : {}),
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

  const host =
    headers.get("x-forwarded-host") || headers.get("host") || "localhost";
  const forwardedProto = headers.get("x-forwarded-proto");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const basePath = getConfiguredAppBasePath();
  const url = `${proto}://${host}${basePath}${MCP_PUBLIC_ROUTE_PREFIX}`;

  return new Request(url, { method, headers });
}

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
    return undefined;
  }

  const method = getMethod(event);

  const authHeader = getRequestHeader(event, "authorization");
  const ownerEmailHeader = getRequestHeader(
    event,
    "x-agent-native-owner-email",
  );
  const requestMeta = deriveRequestMeta(event);
  const hasLocalOwnerHint = Boolean(ownerEmailHeader?.trim());
  const authResult = await verifyAuth(authHeader, ownerEmailHeader, {
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

  const body = method === "POST" ? await readBody(event) : undefined;

  const initializeRequest = body
    ? (Array.isArray(body) ? body : [body]).find(
        (
          m,
        ): m is {
          params?: {
            capabilities?: unknown;
            clientInfo?: { name?: unknown; version?: unknown };
            protocolVersion?: unknown;
          };
        } =>
          typeof m === "object" &&
          m !== null &&
          (m as { method?: unknown }).method === "initialize",
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

  const serverRequestMeta: MCPRequestMeta = {
    ...requestMeta,
    fullSurface: authResult.fullSurface === true,
    inlineMcpApps:
      requestMeta.inlineMcpApps === true &&
      authResult.identity?.firstPartyMcp === true
        ? true
        : undefined,
    ...(authResult.fullCatalog === true ? { fullCatalog: true } : {}),
  };
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
      ...(requestMeta.clientName
        ? { clientUserAgent: requestMeta.clientName }
        : {}),
      ...(typeof protocolVersion === "string" ? { protocolVersion } : {}),
      ...(authResult.identity?.userEmail
        ? { userId: authResult.identity.userEmail }
        : {}),
    });
  }

  const { createMcpHandler } = await import("@modelcontextprotocol/server");
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(config, authResult.identity, serverRequestMeta),
    {
      legacy: "stateless",
      responseMode: "auto",
    },
  );
  const webRequest = buildWebRequest(event, method);
  return handler.fetch(
    webRequest,
    method === "POST" ? { parsedBody: body } : undefined,
  );
}

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
