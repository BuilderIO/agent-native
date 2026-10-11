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
import {
  describeBearerCredentialRefusal,
  type BearerCredentialRefusal,
} from "../server/bearer-credential-refusal.js";
import { CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE } from "../server/credential-membership-unavailable.js";
import { getH3App } from "../server/framework-request-handler.js";
import { getOrigin } from "../server/google-oauth.js";
import { readBody } from "../server/h3-helpers.js";
import {
  verifyAuth,
  McpIdentityVerificationUnavailableError,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
  McpDirectoryProfileValidationError,
  validateMcpDirectoryProfile,
  validateMcpDirectoryWidgetDomain,
  selectMcpActionSurface,
  selectMcpDirectoryWidgetReadActions,
  selectMcpDirectoryWidgetWriteActions,
  type MCPConfig,
  type MCPCallerIdentity,
  type MCPRequestMeta,
} from "./build-server.js";
import { handleMcpFetchRequest } from "./fetch-handler.js";
import {
  buildMcpOAuthChallenge,
  getMcpOAuthAudiences,
  getMcpOAuthIssuer,
  getMcpOAuthProtectedResourceMetadataUrl,
  getMcpOAuthResource,
} from "./oauth-route.js";
import {
  MCP_DIRECTORY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
  MCP_ROUTE_PREFIXES,
  joinMcpRoute,
} from "./route-paths.js";

export { createMCPServerForRequest } from "./build-server.js";
export {
  verifyAuth,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
  selectMcpDirectoryWidgetReadActions,
  selectMcpDirectoryWidgetWriteActions,
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

function buildWebRequest(
  event: H3Event,
  method: string,
  routePath = MCP_PUBLIC_ROUTE_PREFIX,
): Request {
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
  const url = `${proto}://${host}${basePath}${routePath}`;

  return new Request(url, { method, headers });
}

function buildUnauthorizedBody(
  event: H3Event,
  routePath = MCP_PUBLIC_ROUTE_PREFIX,
  refusal?: BearerCredentialRefusal,
): {
  error: string;
  reason?: BearerCredentialRefusal;
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
  const instructions = command
    ? `Authentication required. Run \`${command}\` to re-authenticate this ` +
      `MCP connector without reinstalling it (or, in a Claude Code host, ` +
      `run /mcp and choose Authenticate), then retry. For first-time ` +
      `setup, run \`${firstTimeCommand}\`.`
    : "Authentication required. Authenticate the MCP connector in your host, " +
      "then retry.";
  return {
    error: "Unauthorized",
    ...(refusal ? { reason: refusal } : {}),
    message: refusal
      ? `${describeBearerCredentialRefusal(refusal)} ${instructions}`
      : instructions,
    authenticate: {
      ...(command ? { command } : {}),
      ...(firstTimeCommand ? { firstTimeCommand } : {}),
      ...(authorizeUrl ? { authorizeUrl } : {}),
      ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
      ...(mcpUrl ? { mcpUrl } : {}),
    },
  };
}

const loggedDirectoryProfileFailures = new Set<string>();
const directoryLogMethods = new Set([
  "initialize",
  "notifications/initialized",
  "server/discover",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
  "ping",
]);

function directoryLogMethod(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  if (Array.isArray(body)) return "batch";
  const method = (body as { method?: unknown }).method;
  if (typeof method !== "string") return "other";
  return directoryLogMethods.has(method) ? method : "other";
}

function responseStatusFromEvent(event: H3Event): number {
  const status =
    event.res?.status ??
    (event as any).node?.res?.statusCode ??
    (event as any)._status;
  return typeof status === "number" && Number.isInteger(status) && status > 0
    ? status
    : 200;
}

function responseStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = error as { status?: unknown; statusCode?: unknown };
  for (const candidate of [status.status, status.statusCode]) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 100 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }
  return undefined;
}

function directoryProfileUnavailable(
  event: H3Event,
  validationError: McpDirectoryProfileValidationError,
): { error: string; message: string } {
  const failureKey = `${validationError.code}\0${validationError.message}`;
  if (!loggedDirectoryProfileFailures.has(failureKey)) {
    loggedDirectoryProfileFailures.add(failureKey);
    console.error(
      "[mcp] MCP directory profile validation failed:",
      validationError,
    );
  }
  setResponseStatus(event, 503);
  setResponseHeader(event, "Cache-Control", "no-store");
  return {
    error: "MCP_DIRECTORY_PROFILE_INVALID",
    message:
      "The MCP directory is unavailable because its profile or widget origin is invalid.",
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
async function handleMcpRequestInternal(
  event: H3Event,
  config: MCPConfig,
  routePath = MCP_PUBLIC_ROUTE_PREFIX,
  onMcpMethod?: (method: string) => void,
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
  const directoryProfile =
    routePath === MCP_DIRECTORY_ROUTE_PREFIX
      ? config.directoryProfile
      : undefined;
  if (routePath === MCP_DIRECTORY_ROUTE_PREFIX && !directoryProfile) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  const requestConfig = directoryProfile
    ? {
        ...config,
        catalogMode: "directory" as const,
        connectorCatalog: directoryProfile.connectorCatalog,
        instructions: directoryProfile.instructions,
        keyToolNames: directoryProfile.keyToolNames,
        widgetDomain:
          directoryProfile.widgetDomain ??
          config.widgetDomain ??
          requestMeta.origin,
      }
    : config;
  let authResult: Awaited<ReturnType<typeof verifyAuth>>;
  try {
    authResult = await verifyAuth(authHeader, ownerEmailHeader, {
      allowDevOpen:
        isLoopbackRequest(event) &&
        isLoopbackOrigin(requestMeta.origin) &&
        (hasLocalOwnerHint || getAppConfig().mcp.allowDevOpen),
      resourceUrl: getMcpOAuthAudiences(event, routePath),
      requestOrigin: getOrigin(event),
    });
  } catch (error) {
    if (!(error instanceof McpIdentityVerificationUnavailableError))
      throw error;
    setResponseStatus(event, 503);
    setResponseHeader(event, "Retry-After", "5");
    return {
      error: "Service Unavailable",
      message: CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE,
    };
  }
  if (!authResult.authed && authResult.unavailable) {
    // The token is valid but its org membership could not be checked. No auth
    // challenge: re-authenticating would not help, and the client must keep
    // its tokens and retry.
    setResponseStatus(event, 503);
    setResponseHeader(event, "Retry-After", "5");
    return {
      error: "Service Unavailable",
      message: CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE,
    };
  }
  if (!authResult.authed) {
    setResponseStatus(event, 401);
    setResponseHeader(
      event,
      "WWW-Authenticate",
      buildMcpOAuthChallenge(event, routePath, authResult.refusal),
    );
    return buildUnauthorizedBody(event, routePath, authResult.refusal);
  }

  const body = method === "POST" ? await readBody(event) : undefined;
  onMcpMethod?.(directoryLogMethod(body) ?? method);

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
  if (directoryProfile) {
    try {
      validateMcpDirectoryProfile(
        requestConfig,
        selectMcpActionSurface(requestConfig, serverRequestMeta),
      );
      validateMcpDirectoryWidgetDomain(requestConfig.widgetDomain);
    } catch (error) {
      if (!(error instanceof McpDirectoryProfileValidationError)) throw error;
      return directoryProfileUnavailable(event, error);
    }
  }
  const webRequest = buildWebRequest(event, method, routePath);
  return handleMcpFetchRequest(webRequest, requestConfig, {
    identity: authResult.identity,
    requestMeta: serverRequestMeta,
    parsedBody: body,
  });
}

export async function handleMcpRequest(
  event: H3Event,
  config: MCPConfig,
  routePath = MCP_PUBLIC_ROUTE_PREFIX,
): Promise<
  Response | string | { error: string } | Record<string, unknown> | undefined
> {
  const pathname = event.url?.pathname || "/";
  const subpath = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const isDirectoryRequest =
    routePath === MCP_DIRECTORY_ROUTE_PREFIX && !subpath;
  const startedAt = performance.now();
  let method = getMethod(event);
  let status = 500;

  try {
    const result = await handleMcpRequestInternal(
      event,
      config,
      routePath,
      (requestMethod) => {
        method = requestMethod;
      },
    );
    status =
      result instanceof Response
        ? result.status
        : responseStatusFromEvent(event);
    return result;
  } catch (error) {
    status = responseStatusFromError(error) ?? 500;
    throw error;
  } finally {
    if (isDirectoryRequest) {
      console.info("[mcp:directory] request", {
        method,
        status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    }
  }
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
  if (config.directoryProfile) routePaths.unshift(MCP_DIRECTORY_ROUTE_PREFIX);

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
