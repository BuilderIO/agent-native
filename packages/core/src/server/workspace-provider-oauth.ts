import crypto from "node:crypto";

import {
  deleteCookie,
  defineEventHandler,
  getCookie,
  getMethod,
  getQuery,
  setCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getWorkspaceConnectionProvider,
  type WorkspaceConnectionProvider,
} from "../connections/catalog.js";
import { saveOAuthTokens, setOAuthDisplayName } from "../oauth-tokens/store.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import {
  listWorkspaceConnections,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "../workspace-connections/store.js";
import { getSession, safeReturnPath } from "./auth.js";
import { resolveSecret } from "./credential-provider.js";
import {
  decodeOAuthState,
  encodeOAuthState,
  getAppUrl,
  resolveOAuthRedirectUri,
  type OAuthStatePayload,
} from "./google-oauth.js";
import { runWithRequestContext } from "./request-context.js";

export type GenericWorkspaceOAuthProvider = "figma" | "google_drive" | "notion";

const SUPPORTED_PROVIDERS = new Set<GenericWorkspaceOAuthProvider>([
  "figma",
  "google_drive",
  "notion",
]);
const FLOW_TTL_SECONDS = 10 * 60;
const PROVIDER_REQUEST_TIMEOUT_MS = 10_000;
const PROVIDER_RESPONSE_MAX_BYTES = 256 * 1024;

export interface WorkspaceProviderOAuthFlow {
  provider: GenericWorkspaceOAuthProvider;
  flowId: string;
  verifier: string;
  redirectUri: string;
  owner: string;
  orgId?: string;
  appId: string;
  expiresAt: number;
}

export function workspaceProviderOAuthPath(
  provider: GenericWorkspaceOAuthProvider,
  phase: "start" | "callback",
): string {
  return `/_agent-native/connections/oauth/${provider}/${phase}`;
}

export function createWorkspaceProviderOAuthHandler(
  provider: GenericWorkspaceOAuthProvider,
  phase: "start" | "callback",
) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported workspace OAuth provider: ${provider}`);
  }
  return defineEventHandler((event) =>
    phase === "start"
      ? handleWorkspaceProviderOAuthStart(event, provider)
      : handleWorkspaceProviderOAuthCallback(event, provider),
  );
}

export async function handleWorkspaceProviderOAuthStart(
  event: H3Event,
  providerId: GenericWorkspaceOAuthProvider,
): Promise<Response | Record<string, unknown>> {
  if (getMethod(event) !== "GET") return methodNotAllowed(event);
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return unauthorized(event);
  const provider = requiredProvider(providerId);
  const query = getQuery(event);
  const appId = normalizeAppId(
    text(query.appId) ??
      process.env.AGENT_NATIVE_WORKSPACE_APP_ID ??
      process.env.VITE_AGENT_NATIVE_WORKSPACE_APP_ID ??
      "creative-context",
  );
  const redirectUri = resolveOAuthRedirectUri(
    event,
    workspaceProviderOAuthPath(providerId, "callback"),
  );
  if (!redirectUri) {
    setResponseStatus(event, 400);
    return { error: "Invalid OAuth redirect URI." };
  }
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const [clientId, clientSecret] = await Promise.all([
        resolveSecret(clientCredentialKey(providerId, "id")),
        resolveSecret(clientCredentialKey(providerId, "secret")),
      ]);
      if (!clientId || !clientSecret) {
        setResponseStatus(event, 503);
        return {
          error: `${provider.label} OAuth client credentials are not configured.`,
        };
      }
      const verifier = crypto.randomBytes(48).toString("base64url");
      const challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const flowId = crypto.randomUUID();
      const requestedReturnUrl = text(query.return);
      const returnUrl = requestedReturnUrl
        ? safeReturnPath(requestedReturnUrl)
        : undefined;
      const state = encodeOAuthState({
        redirectUri,
        owner: session.email,
        orgId: session.orgId,
        app: appId,
        returnUrl,
        flowId,
      });
      const flow: WorkspaceProviderOAuthFlow = {
        provider: providerId,
        flowId,
        verifier,
        redirectUri,
        owner: session.email,
        ...(session.orgId ? { orgId: session.orgId } : {}),
        appId,
        expiresAt: Date.now() + FLOW_TTL_SECONDS * 1_000,
      };
      setCookie(
        event,
        flowCookieName(providerId),
        encryptSecretValue(JSON.stringify(flow)),
        {
          httpOnly: true,
          secure: redirectUri.startsWith("https://"),
          sameSite: "lax",
          path: "/",
          maxAge: FLOW_TTL_SECONDS,
        },
      );
      const authorizationUrl = buildWorkspaceProviderAuthorizationUrl({
        provider,
        clientId,
        redirectUri,
        state,
        challenge,
      });
      return Response.redirect(authorizationUrl, 302);
    },
  );
}

export async function handleWorkspaceProviderOAuthCallback(
  event: H3Event,
  providerId: GenericWorkspaceOAuthProvider,
): Promise<Response | Record<string, unknown>> {
  if (getMethod(event) !== "GET") return methodNotAllowed(event);
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return unauthorized(event);
  const query = getQuery(event);
  const code = text(query.code);
  const stateParam = text(query.state);
  const providerError = text(query.error);
  if (providerError) {
    setResponseStatus(event, 400);
    return { error: "OAuth authorization was not completed." };
  }
  if (!code || !stateParam) {
    setResponseStatus(event, 400);
    return { error: "OAuth callback is missing code or state." };
  }
  const flow = readStoredFlow(event, providerId);
  deleteCookie(event, flowCookieName(providerId), { path: "/" });
  const state = decodeOAuthState(stateParam, "");
  if (
    !flow ||
    !isWorkspaceProviderOAuthFlowValid({
      flow,
      state,
      provider: providerId,
      sessionEmail: session.email,
      sessionOrgId: session.orgId,
    })
  ) {
    setResponseStatus(event, 400);
    return { error: "OAuth state is invalid or expired." };
  }
  const provider = requiredProvider(providerId);
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const [clientId, clientSecret] = await Promise.all([
        resolveSecret(clientCredentialKey(providerId, "id")),
        resolveSecret(clientCredentialKey(providerId, "secret")),
      ]);
      if (!clientId || !clientSecret) {
        setResponseStatus(event, 503);
        return {
          error: `${provider.label} OAuth client credentials are not configured.`,
        };
      }
      const tokens = await exchangeWorkspaceProviderOAuthCode({
        providerId,
        provider,
        clientId,
        clientSecret,
        code,
        verifier: flow.verifier,
        redirectUri: flow.redirectUri,
      });
      const identity = await resolveWorkspaceProviderIdentity(
        providerId,
        tokens,
      );
      await saveOAuthTokens(
        provider.oauth!.provider,
        identity.accountId,
        tokens,
        session.email,
      );
      await setOAuthDisplayName(
        provider.oauth!.provider,
        identity.accountId,
        identity.label,
      );
      const existing = (
        await listWorkspaceConnections({
          provider: providerId,
          includeDisabled: true,
        })
      ).find((connection) => connection.accountId === identity.accountId);
      const scopes = mergeWorkspaceOAuthValues(
        existing?.scopes ?? [],
        tokenScopes(tokens, provider.oauth!.scopes),
      );
      const connection = await upsertWorkspaceConnection({
        ...(existing ? { id: existing.id } : {}),
        provider: providerId,
        label: `${provider.label}: ${identity.label}`,
        accountId: identity.accountId,
        accountLabel: identity.label,
        status: "connected",
        scopes,
        allowedApps: mergeWorkspaceOAuthValues(existing?.allowedApps ?? [], [
          flow.appId,
        ]),
        config: { credentialMode: "oauth" },
        lastCheckedAt: new Date(),
        lastError: null,
      });
      await upsertWorkspaceConnectionGrant({
        connectionId: connection.id,
        appId: flow.appId,
        provider: providerId,
        scopes,
        config: { credentialMode: "oauth" },
      });
      const returnPath =
        state.returnUrl ??
        `/settings/connections?connected=${encodeURIComponent(providerId)}`;
      return Response.redirect(getAppUrl(event, returnPath), 302);
    },
  );
}

export function buildWorkspaceProviderAuthorizationUrl(input: {
  provider: WorkspaceConnectionProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  if (!input.provider.oauth)
    throw new Error("Provider does not support OAuth.");
  const url = new URL(input.provider.oauth.authorizationUrl);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (input.provider.id === "figma") {
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (input.provider.id === "google_drive") {
    url.searchParams.set("access_type", "offline");
    // The shared Google project may already hold sensitive grants for other
    // apps; combining them can trigger an unverified-app warning here.
    url.searchParams.set("include_granted_scopes", "false");
    url.searchParams.set("prompt", "consent");
  }
  if (input.provider.oauth.scopes.length) {
    url.searchParams.set("scope", input.provider.oauth.scopes.join(" "));
  }
  if (input.provider.id === "notion") url.searchParams.set("owner", "user");
  return url.href;
}

export async function exchangeWorkspaceProviderOAuthCode(input: {
  providerId: GenericWorkspaceOAuthProvider;
  provider: WorkspaceConnectionProvider;
  clientId: string;
  clientSecret: string;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<Record<string, unknown>> {
  const tokenUrl = input.provider.oauth?.tokenUrl;
  if (!tokenUrl) throw new Error("Provider does not support OAuth.");
  const authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`;
  const fields = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    ...(input.providerId === "figma" ? { code_verifier: input.verifier } : {}),
    ...(input.providerId === "google_drive"
      ? { client_id: input.clientId, client_secret: input.clientSecret }
      : {}),
  };
  const { response, body } = await fetchBoundedProviderJson(
    tokenUrl,
    {
      method: "POST",
      headers:
        input.providerId === "notion"
          ? {
              Authorization: authorization,
              Accept: "application/json",
              "Content-Type": "application/json",
            }
          : input.providerId === "figma"
            ? {
                Authorization: authorization,
                "Content-Type": "application/x-www-form-urlencoded",
              }
            : { "Content-Type": "application/x-www-form-urlencoded" },
      body:
        input.providerId === "notion"
          ? JSON.stringify(fields)
          : new URLSearchParams(fields),
    },
    input.provider.label,
  );
  const accessToken = text(body.access_token);
  if (!response.ok || !accessToken) {
    throw new Error(
      `${input.provider.label} OAuth token exchange failed (${response.status}).`,
    );
  }
  const expiresIn = Number(body.expires_in);
  return {
    ...body,
    ...(Number.isFinite(expiresIn) && expiresIn > 0
      ? { expiry_date: Date.now() + expiresIn * 1_000 }
      : {}),
  };
}

export async function resolveWorkspaceProviderIdentity(
  providerId: GenericWorkspaceOAuthProvider,
  tokens: Record<string, unknown>,
): Promise<{ accountId: string; label: string }> {
  if (providerId === "notion") {
    const owner = record(tokens.owner);
    const user = record(owner?.user);
    const person = record(user?.person);
    const accountId =
      text(user?.id) ??
      text(person?.email) ??
      text(tokens.workspace_id) ??
      text(tokens.bot_id);
    if (!accountId)
      throw new Error(
        "Notion OAuth response did not identify the connected user.",
      );
    return {
      accountId,
      label:
        text(person?.email) ??
        text(tokens.workspace_name) ??
        "Notion workspace",
    };
  }
  if (providerId === "google_drive") {
    const accessToken = text(tokens.access_token)!;
    const { response, body } = await fetchBoundedProviderJson(
      "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "Google Drive",
    );
    const user = record(body.user);
    const accountId = text(user?.permissionId) ?? text(user?.emailAddress);
    if (!response.ok || !accountId) {
      throw new Error(
        "Google Drive OAuth response did not identify the connected account.",
      );
    }
    return {
      accountId,
      label:
        text(user?.emailAddress) ??
        text(user?.displayName) ??
        "Google Drive account",
    };
  }
  const accessToken = text(tokens.access_token)!;
  const { response, body: me } = await fetchBoundedProviderJson(
    "https://api.figma.com/v1/me",
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Figma",
  );
  const accountId = text(me.id) ?? text(me.email) ?? text(tokens.user_id);
  if (!response.ok || !accountId) {
    throw new Error(
      "Figma OAuth response did not identify the connected user.",
    );
  }
  return {
    accountId,
    label: text(me.email) ?? text(me.handle) ?? "Figma account",
  };
}

function requiredProvider(
  providerId: GenericWorkspaceOAuthProvider,
): WorkspaceConnectionProvider {
  const provider = getWorkspaceConnectionProvider(providerId);
  if (!provider?.oauth)
    throw new Error(`${providerId} OAuth is not configured.`);
  return provider;
}

function readStoredFlow(
  event: H3Event,
  provider: GenericWorkspaceOAuthProvider,
): WorkspaceProviderOAuthFlow | null {
  const encrypted = getCookie(event, flowCookieName(provider));
  if (!encrypted) return null;
  try {
    return JSON.parse(
      decryptSecretValue(encrypted),
    ) as WorkspaceProviderOAuthFlow;
  } catch {
    return null;
  }
}

export function isWorkspaceProviderOAuthFlowValid(input: {
  flow: WorkspaceProviderOAuthFlow;
  state: OAuthStatePayload;
  provider: GenericWorkspaceOAuthProvider;
  sessionEmail: string;
  sessionOrgId?: string;
  now?: number;
}): boolean {
  return (
    input.flow.expiresAt >= (input.now ?? Date.now()) &&
    input.flow.provider === input.provider &&
    input.state.flowId === input.flow.flowId &&
    input.state.redirectUri === input.flow.redirectUri &&
    input.state.owner === input.flow.owner &&
    input.sessionEmail === input.flow.owner &&
    input.state.orgId === input.flow.orgId &&
    input.sessionOrgId === input.flow.orgId &&
    input.state.app === input.flow.appId
  );
}

async function fetchBoundedProviderJson(
  url: string,
  init: RequestInit,
  providerLabel: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`${providerLabel} OAuth request failed.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PROVIDER_RESPONSE_MAX_BYTES
  ) {
    throw new Error(`${providerLabel} OAuth response exceeded the size limit.`);
  }
  if (!response.body) return { response, body: {} };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PROVIDER_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(chunk.value);
    }
  } catch {
    throw new Error(`${providerLabel} OAuth request failed.`);
  }
  if (length > PROVIDER_RESPONSE_MAX_BYTES) {
    throw new Error(`${providerLabel} OAuth response exceeded the size limit.`);
  }
  try {
    const json = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(json) as unknown;
    return { response, body: record(body) ?? {} };
  } catch {
    return { response, body: {} };
  }
}

function tokenScopes(
  tokens: Record<string, unknown>,
  fallback: readonly string[],
): string[] {
  const scope = text(tokens.scope);
  return scope ? scope.split(/[ ,]+/).filter(Boolean) : [...fallback];
}

export function mergeWorkspaceOAuthValues(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  return [...new Set([...existing, ...incoming])];
}

function clientCredentialKey(
  provider: GenericWorkspaceOAuthProvider,
  field: "id" | "secret",
): string {
  const prefix =
    provider === "google_drive" ? "GOOGLE" : provider.toUpperCase();
  return `${prefix}_CLIENT_${field === "id" ? "ID" : "SECRET"}`;
}

function flowCookieName(provider: GenericWorkspaceOAuthProvider): string {
  return `an_workspace_oauth_${provider}`;
}

function normalizeAppId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(normalized)) {
    throw new Error("OAuth appId is invalid.");
  }
  return normalized;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function methodNotAllowed(event: H3Event) {
  setResponseStatus(event, 405);
  return { error: "Method not allowed" };
}

function unauthorized(event: H3Event) {
  setResponseStatus(event, 401);
  return { error: "Authentication required" };
}
