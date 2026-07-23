import crypto from "node:crypto";

import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  deleteCookie,
  defineEventHandler,
  getChunkedCookie,
  getCookie,
  getMethod,
  getQuery,
  setChunkedCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import { getSession, safeReturnPath } from "../server/auth.js";
import { getH3App } from "../server/framework-request-handler.js";
import { getAppUrl, resolveOAuthRedirectUri } from "../server/google-oauth.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  finishMcpOAuthAuthorization,
  startMcpOAuthAuthorization,
  type McpOAuthDiscoveryState,
} from "./oauth-client.js";
import {
  addOAuthRemoteServer,
  normalizeServerName,
  validateRemoteUrl,
  type RemoteMcpScope,
} from "./remote-store.js";

const FLOW_COOKIE = "an_mcp_oauth_flow";
const FLOW_TTL_SECONDS = 10 * 60;
const FLOW_COOKIE_CHUNK_SIZE = 2_800;
const FLOW_COOKIE_MAX_CHUNKS = 8;
const CHUNKED_COOKIE_PREFIX = "__chunked__";

export interface McpOAuthFlow {
  name: string;
  url: string;
  description?: string;
  scope: RemoteMcpScope;
  scopeId: string;
  owner: string;
  orgId?: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  clientInformation: OAuthClientInformationMixed;
  discoveryState?: McpOAuthDiscoveryState;
  returnUrl?: string;
  expiresAt: number;
}

export interface McpOAuthRoutesOptions {
  reconfigure: () => Promise<void>;
}

export function redirectWithStagedCookies(
  event: H3Event,
  location: string,
): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
  });
  for (const cookie of event.res?.headers?.getSetCookie?.() ?? []) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

export function mountMcpOAuthRoutes(
  nitroApp: any,
  options: McpOAuthRoutesOptions,
): void {
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpOAuthMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);

  getH3App(nitroApp).use(
    "/_agent-native/mcp/servers/oauth",
    defineEventHandler(async (event: H3Event) => {
      const method = getMethod(event);
      const pathname = (event.url?.pathname || "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const parts = pathname ? pathname.split("/") : [];
      if (method !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      if (parts.length === 1 && parts[0] === "start") {
        return handleMcpOAuthStart(event);
      }
      if (parts.length === 1 && parts[0] === "callback") {
        return handleMcpOAuthCallback(event, options);
      }
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }),
  );
}

async function handleMcpOAuthStart(
  event: H3Event,
): Promise<Response | Record<string, unknown>> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return unauthorized(event);

  const query = getQuery(event);
  const rawUrl = text(query.url);
  const rawName = text(query.name);
  const returnUrl = text(query.return);
  if (!rawUrl || !rawName) {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth requires a server name and URL." };
  }
  const urlCheck = validateRemoteUrl(rawUrl);
  if (!urlCheck.ok) {
    setResponseStatus(event, 400);
    return { error: urlCheck.error ?? "MCP server URL is not allowed." };
  }
  const name = normalizeServerName(rawName);
  if (!name) {
    setResponseStatus(event, 400);
    return { error: "MCP server name is invalid." };
  }

  const requestedScope = query.scope === "org" ? "org" : "user";
  const requestedOrgId = text(query.orgId);
  const org =
    requestedScope === "org"
      ? await getOrgContext(event).catch(() => null)
      : null;
  const scope: RemoteMcpScope = requestedScope;
  const scopeId = scope === "user" ? session.email : (org?.orgId ?? "");
  if (scope === "org" && requestedOrgId && requestedOrgId !== scopeId) {
    setResponseStatus(event, 403);
    return {
      error: "The selected organization is not the active organization.",
    };
  }
  if (scope === "org" && (!scopeId || !isOrgAdmin(org?.role))) {
    setResponseStatus(event, scopeId ? 403 : 400);
    return {
      error: scopeId
        ? "Only organization owners and admins can connect an org MCP server."
        : "Join an organization before connecting an org MCP server.",
    };
  }

  const redirectUri = resolveOAuthRedirectUri(
    event,
    "/_agent-native/mcp/servers/oauth/callback",
  );
  if (!redirectUri) {
    setResponseStatus(event, 400);
    return { error: "Invalid MCP OAuth redirect URI." };
  }

  const state = crypto.randomUUID();
  const safeReturnUrl = returnUrl ? safeReturnPath(returnUrl) : undefined;
  try {
    const started = await runWithRequestContext(
      { userEmail: session.email, orgId: org?.orgId ?? undefined },
      () =>
        startMcpOAuthAuthorization({
          serverUrl: urlCheck.url!.toString(),
          redirectUrl: redirectUri,
          state,
        }),
    );
    const flow: McpOAuthFlow = {
      name,
      url: urlCheck.url!.toString(),
      description: text(query.description),
      scope,
      scopeId,
      owner: session.email,
      ...(org?.orgId ? { orgId: org.orgId } : {}),
      redirectUri,
      state: started.state,
      codeVerifier: started.codeVerifier,
      clientInformation: started.clientInformation,
      ...(started.discoveryState
        ? { discoveryState: started.discoveryState }
        : {}),
      ...(safeReturnUrl ? { returnUrl: safeReturnUrl } : {}),
      expiresAt: Date.now() + FLOW_TTL_SECONDS * 1_000,
    };
    setMcpOAuthFlowCookie(event, flow, redirectUri.startsWith("https://"));
    return redirectWithStagedCookies(event, started.authorizationUrl.href);
  } catch {
    setResponseStatus(event, 400);
    return {
      error:
        "This MCP server could not start OAuth. It may not support standard MCP OAuth discovery or dynamic client registration.",
    };
  }
}

async function handleMcpOAuthCallback(
  event: H3Event,
  options: McpOAuthRoutesOptions,
): Promise<Response | Record<string, unknown>> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return unauthorized(event);

  const query = getQuery(event);
  const code = text(query.code);
  const state = text(query.state);
  const providerError = text(query.error);
  const flow = readMcpOAuthFlowCookie(event);
  clearMcpOAuthFlowCookies(event);
  if (providerError || !code || !state) {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth authorization was not completed." };
  }
  const org =
    flow?.scope === "org" ? await getOrgContext(event).catch(() => null) : null;
  if (
    !flow ||
    !isValidMcpOAuthFlow(flow, session.email, org?.orgId ?? undefined, state)
  ) {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth state is invalid or expired." };
  }
  if (flow.scope === "org" && !isOrgAdmin(org?.role)) {
    setResponseStatus(event, 403);
    return {
      error:
        "Only organization owners and admins can connect an org MCP server.",
    };
  }

  try {
    const finished = await runWithRequestContext(
      { userEmail: session.email, orgId: org?.orgId ?? undefined },
      () =>
        finishMcpOAuthAuthorization({
          serverUrl: flow.url,
          redirectUrl: flow.redirectUri,
          state: flow.state,
          clientInformation: flow.clientInformation,
          codeVerifier: flow.codeVerifier,
          discoveryState: flow.discoveryState,
          authorizationCode: code,
        }),
    );
    const result = await addOAuthRemoteServer(flow.scope, flow.scopeId, {
      name: flow.name,
      url: flow.url,
      description: flow.description,
      credentials: finished.credentials,
    });
    if (!result.ok) {
      setResponseStatus(event, 400);
      return { error: result.error };
    }
    await options.reconfigure();
    const returnPath =
      flow.returnUrl ??
      `/settings/connections?connected=mcp-${encodeURIComponent(flow.name)}`;
    return redirectWithStagedCookies(event, getAppUrl(event, returnPath));
  } catch {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth authorization could not be completed." };
  }
}

export function setMcpOAuthFlowCookie(
  event: H3Event,
  flow: McpOAuthFlow,
  secure: boolean,
): void {
  const encrypted = encryptSecretValue(JSON.stringify(flow));
  const chunkCount = Math.ceil(encrypted.length / FLOW_COOKIE_CHUNK_SIZE);
  if (chunkCount > FLOW_COOKIE_MAX_CHUNKS) {
    throw new Error("MCP OAuth flow state exceeds the cookie size limit.");
  }
  setChunkedCookie(event, FLOW_COOKIE, encrypted, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: FLOW_TTL_SECONDS,
    chunkMaxLength: FLOW_COOKIE_CHUNK_SIZE,
  });
}

export function readMcpOAuthFlowCookie(event: H3Event): McpOAuthFlow | null {
  const primaryCookie = getCookie(event, FLOW_COOKIE);
  if (!primaryCookie) return null;
  if (primaryCookie.startsWith(CHUNKED_COOKIE_PREFIX)) {
    const rawCount = primaryCookie.slice(CHUNKED_COOKIE_PREFIX.length);
    if (!/^\d+$/.test(rawCount)) return null;
    const chunkCount = Number(rawCount);
    if (chunkCount < 2 || chunkCount > FLOW_COOKIE_MAX_CHUNKS) return null;
  }
  const encrypted = getChunkedCookie(event, FLOW_COOKIE);
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decryptSecretValue(encrypted)) as McpOAuthFlow;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearMcpOAuthFlowCookies(event: H3Event): void {
  deleteCookie(event, FLOW_COOKIE, { path: "/" });
  for (let index = 1; index <= FLOW_COOKIE_MAX_CHUNKS; index += 1) {
    deleteCookie(event, `${FLOW_COOKIE}.${index}`, { path: "/" });
  }
}

export function isValidMcpOAuthFlow(
  flow: McpOAuthFlow,
  email: string,
  orgId: string | undefined,
  state: string,
): boolean {
  const scopeMatches =
    flow.scope === "user"
      ? flow.scopeId === email && !flow.orgId
      : flow.scope === "org" && flow.scopeId === orgId && flow.orgId === orgId;
  return (
    flow.expiresAt >= Date.now() &&
    flow.owner === email &&
    flow.state === state &&
    scopeMatches &&
    typeof flow.scopeId === "string" &&
    typeof flow.redirectUri === "string" &&
    flow.redirectUri.includes("/_agent-native/mcp/servers/oauth/callback")
  );
}

function isOrgAdmin(role: unknown): boolean {
  return role === "owner" || role === "admin";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unauthorized(event: H3Event) {
  setResponseStatus(event, 401);
  return { error: "Authentication required" };
}
