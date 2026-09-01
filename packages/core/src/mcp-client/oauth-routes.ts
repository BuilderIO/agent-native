import crypto from "node:crypto";

import type { StoredOAuthClientInformation } from "@modelcontextprotocol/client";
import {
  deleteCookie,
  defineEventHandler,
  getMethod,
  getQuery,
  setChunkedCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { encryptSecretValue } from "../secrets/crypto.js";
import { getSession, safeReturnPath } from "../server/auth.js";
import {
  CredentialStoreUnavailableError,
  resolveSecretPairs,
} from "../server/credential-provider.js";
import { getH3App } from "../server/framework-request-handler.js";
import {
  getAppBasePath,
  getAppUrl,
  encodeOAuthState,
  resolveOAuthRedirectUri,
} from "../server/google-oauth.js";
import { runWithRequestContext } from "../server/request-context.js";
import { isWorkspaceOAuthCallbackRelayEnabled } from "../server/workspace-oauth.js";
import { isValidWorkspaceAppIdFormat } from "../shared/workspace-app-id.js";
import {
  finishMcpOAuthAuthorization,
  isGoogleWorkspaceMcpServer,
  startMcpOAuthAuthorization,
  type McpOAuthCredentialBundle,
  type McpOAuthDiscoveryState,
  validateMcpOAuthCallbackIssuer,
} from "./oauth-client.js";
import {
  MCP_OAUTH_FLOW_COOKIE as FLOW_COOKIE,
  MCP_OAUTH_FLOW_COOKIE_CHUNK_SIZE as FLOW_COOKIE_CHUNK_SIZE,
  MCP_OAUTH_FLOW_COOKIE_MAX_CHUNKS as FLOW_COOKIE_MAX_CHUNKS,
  readMcpOAuthFlowCookiePayload,
} from "./oauth-flow-cookie.js";
import {
  addOAuthRemoteServer,
  listRemoteServers,
  normalizeServerName,
  replaceOAuthRemoteServer,
  validateRemoteUrl,
  type StoredRemoteMcpServer,
  type RemoteMcpScope,
} from "./remote-store.js";

export function resolveTrustedMcpOAuthAuthorizationScope(
  serverUrl: URL,
): string | undefined {
  return serverUrl.href === "https://mcp.builder.io/mcp/publish"
    ? "mcp:publish:read"
    : undefined;
}

function isBuilderPublishMcpServer(serverUrl: URL): boolean {
  return resolveTrustedMcpOAuthAuthorizationScope(serverUrl) !== undefined;
}

const FLOW_TTL_SECONDS = 10 * 60;
const MCP_WORKSPACE_STATE_PROVIDER = "mcp";

const MANAGED_MCP_OAUTH_CLIENTS: ReadonlyArray<{
  serverOrigins: ReadonlyArray<string>;
  credentialPairs: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    serverOrigins: ["https://mcp.hubspot.com"],
    credentialPairs: [
      ["HUBSPOT_MCP_CLIENT_ID", "HUBSPOT_MCP_CLIENT_SECRET"],
      ["HUBSPOT_INTEGRATION_CLIENT_ID", "HUBSPOT_INTEGRATION_CLIENT_SECRET"],
      ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"],
    ],
  },
  {
    serverOrigins: [
      "https://gmailmcp.googleapis.com",
      "https://drivemcp.googleapis.com",
      "https://docsmcp.googleapis.com",
      "https://sheetsmcp.googleapis.com",
      "https://slidesmcp.googleapis.com",
      "https://calendarmcp.googleapis.com",
      "https://chatmcp.googleapis.com",
      "https://people.googleapis.com",
    ],
    credentialPairs: [["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
  },
  {
    serverOrigins: ["https://workspacemcp.googleapis.com"],
    credentialPairs: [["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
  },
];

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
  clientInformation: StoredOAuthClientInformation;
  discoveryState?: McpOAuthDiscoveryState;
  authorizationScope?: string;
  returnUrl?: string;
  replaceServerId?: string;
  expiresAt: number;
}

export interface McpOAuthRoutesOptions {
  reconfigure: (target: {
    scope: RemoteMcpScope;
    scopeId: string;
    server: StoredRemoteMcpServer;
  }) => Promise<boolean>;
}

export function resolveMcpOAuthReturnPath(
  connected: boolean,
  flow: Pick<McpOAuthFlow, "name" | "returnUrl">,
): string {
  if (!connected) return "/settings/integrations";
  return (
    flow.returnUrl ??
    `/settings/integrations?connected=mcp-${encodeURIComponent(flow.name)}`
  );
}

export function bindMcpOAuthAuthorizationScope(
  flow: Pick<McpOAuthFlow, "authorizationScope">,
  credentials: McpOAuthCredentialBundle,
): McpOAuthCredentialBundle {
  return flow.authorizationScope && !credentials.tokens.scope
    ? {
        ...credentials,
        tokens: { ...credentials.tokens, scope: flow.authorizationScope },
      }
    : credentials;
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
  const reconnectServerId = text(query.serverId);
  const reconnectScope: RemoteMcpScope = query.scope === "org" ? "org" : "user";
  const reconnectOrg =
    reconnectScope === "org" ? await getOrgContext(event) : null;
  const reconnectScopeId =
    reconnectScope === "user" ? session.email : (reconnectOrg?.orgId ?? "");
  let reconnectServer:
    | Awaited<ReturnType<typeof listRemoteServers>>[number]
    | undefined;
  if (reconnectServerId) {
    if (
      reconnectScope === "org" &&
      (!reconnectScopeId || !isOrgAdmin(reconnectOrg?.role))
    ) {
      setResponseStatus(event, reconnectScopeId ? 403 : 400);
      return {
        error: reconnectScopeId
          ? "Only organization owners and admins can reconnect an org MCP server."
          : "Join an organization before reconnecting an org MCP server.",
      };
    }
    reconnectServer = (
      await listRemoteServers(reconnectScope, reconnectScopeId)
    ).find((server) => server.id === reconnectServerId);
    if (!reconnectServer) {
      setResponseStatus(event, 404);
      return { error: "MCP server was not found." };
    }
    if (!reconnectServer.oauthSecretKey) {
      setResponseStatus(event, 400);
      return { error: "This MCP server does not use OAuth credentials." };
    }
  }

  const rawUrl = reconnectServer?.url ?? text(query.url);
  const rawName = reconnectServer?.name ?? text(query.name);
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

  const requestedScope = resolveMcpOAuthScope(urlCheck.url!, query.scope, {
    allowManagedOrgReconnect:
      reconnectScope === "org" && Boolean(reconnectServer),
  });
  if (!requestedScope) {
    setResponseStatus(event, 400);
    return {
      error: "Managed MCP OAuth connections must use personal scope.",
    };
  }
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

  const useRootGoogleCallback =
    isWorkspaceOAuthCallbackRelayEnabled() &&
    isGoogleWorkspaceMcpServer(urlCheck.url!);
  const workspaceAppId = useRootGoogleCallback
    ? getWorkspaceOAuthAppId()
    : undefined;
  if (useRootGoogleCallback && !workspaceAppId) {
    setResponseStatus(event, 400);
    return { error: "Workspace MCP OAuth is missing its app callback id." };
  }
  const redirectUri = resolveOAuthRedirectUri(
    event,
    useRootGoogleCallback
      ? "/_agent-native/google/callback"
      : "/_agent-native/mcp/servers/oauth/callback",
  );
  if (!redirectUri) {
    setResponseStatus(event, 400);
    return { error: "Invalid MCP OAuth redirect URI." };
  }
  if (useRootGoogleCallback && !isRootGoogleCallback(redirectUri)) {
    setResponseStatus(event, 400);
    return {
      error: "Google Workspace MCP OAuth must use the shared callback.",
    };
  }

  const state = useRootGoogleCallback
    ? encodeOAuthState({
        redirectUri,
        app: workspaceAppId,
        provider: MCP_WORKSPACE_STATE_PROVIDER,
      })
    : crypto.randomUUID();
  const safeReturnUrl = returnUrl ? safeReturnPath(returnUrl) : undefined;
  const requestContext = {
    userEmail: session.email,
    orgId: org?.orgId ?? undefined,
  };
  try {
    const started = await runWithRequestContext(requestContext, async () => {
      const clientInformation = await resolveManagedMcpOAuthClient(
        urlCheck.url!,
      );
      if (isManagedMcpOAuthServer(urlCheck.url!) && !clientInformation) {
        return null;
      }
      const authorizationScope = resolveTrustedMcpOAuthAuthorizationScope(
        urlCheck.url!,
      );
      return startMcpOAuthAuthorization({
        serverUrl: urlCheck.url!.toString(),
        redirectUrl: redirectUri,
        state,
        ...(authorizationScope ? { scope: authorizationScope } : {}),
        ...(clientInformation ? { clientInformation } : {}),
      });
    });
    if (!started) {
      setResponseStatus(event, 400);
      return {
        error:
          "Managed MCP OAuth is not configured for this workspace. A workspace owner must register the OAuth client once; after that, any workspace member can connect a personal account.",
      };
    }
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
      ...(resolveTrustedMcpOAuthAuthorizationScope(urlCheck.url!)
        ? {
            authorizationScope: resolveTrustedMcpOAuthAuthorizationScope(
              urlCheck.url!,
            ),
          }
        : {}),
      ...(safeReturnUrl ? { returnUrl: safeReturnUrl } : {}),
      ...(reconnectServerId ? { replaceServerId: reconnectServerId } : {}),
      expiresAt: Date.now() + FLOW_TTL_SECONDS * 1_000,
    };
    setMcpOAuthFlowCookie(event, flow, redirectUri.startsWith("https://"));
    return redirectWithStagedCookies(event, started.authorizationUrl.href);
  } catch (error) {
    const failure = resolveMcpOAuthStartError(error);
    setResponseStatus(event, failure.status);
    return failure.body;
  }
}

export function resolveMcpOAuthStartError(error: unknown): {
  status: 400 | 503;
  body: { error: string; errorCode?: string; retryable?: boolean };
} {
  if (error instanceof CredentialStoreUnavailableError) {
    return {
      status: 503,
      body: {
        error: error.message,
        errorCode: error.errorCode,
        retryable: error.retryable,
      },
    };
  }
  return {
    status: 400,
    body: {
      error:
        "This MCP server could not start OAuth. It may not support standard MCP OAuth discovery or dynamic client registration.",
    },
  };
}

function isManagedMcpOAuthServer(serverUrl: URL): boolean {
  return MANAGED_MCP_OAUTH_CLIENTS.some((client) =>
    client.serverOrigins.includes(serverUrl.origin),
  );
}

export function resolveMcpOAuthScope(
  serverUrl: URL,
  requestedScope: unknown,
  options?: { allowManagedOrgReconnect?: boolean },
): RemoteMcpScope | null {
  if (isBuilderPublishMcpServer(serverUrl)) {
    return requestedScope === "org" ? "org" : null;
  }
  if (
    isManagedMcpOAuthServer(serverUrl) &&
    requestedScope === "org" &&
    !options?.allowManagedOrgReconnect
  ) {
    return null;
  }
  return requestedScope === "org" ? "org" : "user";
}

export function stripMcpOAuthAppBasePath(
  path: string,
  basePath: string,
): string {
  const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  if (normalizedBase === "/") return path;
  const suffixStart = path.search(/[?#]/);
  const pathname = suffixStart === -1 ? path : path.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : path.slice(suffixStart);
  if (pathname === normalizedBase) return `/${suffix}`;
  return pathname.startsWith(`${normalizedBase}/`)
    ? `${pathname.slice(normalizedBase.length)}${suffix}`
    : path;
}

export async function resolveManagedMcpOAuthClient(
  serverUrl: URL,
): Promise<StoredOAuthClientInformation | undefined> {
  const client = MANAGED_MCP_OAUTH_CLIENTS.find((candidate) =>
    candidate.serverOrigins.includes(serverUrl.origin),
  );
  if (!client) return undefined;

  const credentials = await resolveSecretPairs(client.credentialPairs, {
    allowUserScope: false,
    preferWorkspaceScope: true,
  });
  if (credentials) {
    const [clientId, clientSecret] = credentials;
    return {
      client_id: clientId,
      client_secret: clientSecret,
      token_endpoint_auth_method: "client_secret_post",
    } as StoredOAuthClientInformation;
  }
  return undefined;
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
  const iss = text(query.iss);
  const providerError = text(query.error);
  const flow = readMcpOAuthFlowCookie(event);
  clearMcpOAuthFlowCookies(event);
  const org =
    flow?.scope === "org" ? await getOrgContext(event).catch(() => null) : null;
  if (
    !state ||
    !flow ||
    !isValidMcpOAuthFlow(flow, session.email, org?.orgId ?? undefined, state)
  ) {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth state is invalid or expired." };
  }
  try {
    validateMcpOAuthCallbackIssuer(flow.discoveryState, iss);
  } catch {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth authorization response issuer is invalid." };
  }
  if (providerError || !code) {
    setResponseStatus(event, 400);
    return { error: "MCP OAuth authorization was not completed." };
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
          iss,
        }),
    );
    const credentials = bindMcpOAuthAuthorizationScope(
      flow,
      finished.credentials,
    );
    const result = flow.replaceServerId
      ? await replaceOAuthRemoteServer(
          flow.scope,
          flow.scopeId,
          flow.replaceServerId,
          credentials,
        )
      : await addOAuthRemoteServer(flow.scope, flow.scopeId, {
          name: flow.name,
          url: flow.url,
          description: flow.description,
          credentials,
        });
    if (!result.ok) {
      setResponseStatus(event, 400);
      return { error: result.error };
    }
    const connected = await options.reconfigure({
      scope: flow.scope,
      scopeId: flow.scopeId,
      server: result.server,
    });
    const returnPath = resolveMcpOAuthReturnPath(connected, flow);
    return redirectWithStagedCookies(
      event,
      getAppUrl(event, stripMcpOAuthAppBasePath(returnPath, getAppBasePath())),
    );
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
  const result = readMcpOAuthFlowCookiePayload(event);
  return result.status === "ok"
    ? (result.value as unknown as McpOAuthFlow)
    : null;
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
    isMcpOAuthRedirectUri(flow.redirectUri)
  );
}

function getWorkspaceOAuthAppId(): string | undefined {
  const appId = getAppBasePath().replace(/^\/+|\/+$/g, "");
  return isValidWorkspaceAppIdFormat(appId) ? appId : undefined;
}

function isRootGoogleCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.pathname === "/_agent-native/google/callback" &&
      !url.search &&
      !url.hash
    );
  } catch {
    // coercion-ok: malformed callback URLs are invalid validation candidates.
    return false;
  }
}

function isMcpOAuthRedirectUri(value: string): boolean {
  try {
    const pathname = new URL(value).pathname;
    return (
      pathname.endsWith("/_agent-native/mcp/servers/oauth/callback") ||
      pathname.endsWith("/_agent-native/google/callback")
    );
  } catch {
    // coercion-ok: malformed redirect URLs are invalid validation candidates.
    return false;
  }
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
