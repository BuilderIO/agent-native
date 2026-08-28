import crypto from "node:crypto";

import {
  deleteCookie,
  defineEventHandler,
  getCookie,
  getMethod,
  getQuery,
  getRequestHeader,
  setCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getAppConfig } from "../app-config/index.js";
import {
  getWorkspaceConnectionProvider,
  type WorkspaceConnectionProvider,
} from "../connections/catalog.js";
import { saveOAuthTokens, setOAuthDisplayName } from "../oauth-tokens/store.js";
import { getRegisteredAppRoles, resolveAppRole } from "../org/app-roles.js";
import { getOrgContext } from "../org/context.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import {
  listWorkspaceConnections,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "../workspace-connections/store.js";
import {
  getSession,
  redirectWithStagedCookies,
  safeReturnPath,
} from "./auth.js";
import { resolveSecret } from "./credential-provider.js";
import {
  decodeOAuthState,
  encodeOAuthState,
  getAppBasePath,
  getAppUrl,
  oauthErrorPage,
  resolveOAuthRedirectUri,
  type OAuthStatePayload,
} from "./google-oauth.js";
import { runWithRequestContext } from "./request-context.js";
import { isWorkspaceOAuthCallbackRelayEnabled } from "./workspace-oauth.js";

export type GenericWorkspaceOAuthProvider =
  | "figma"
  | "gmail"
  | "google_calendar"
  | "google_docs"
  | "google_drive"
  | "google_sheets"
  | "google_slides"
  | "github"
  | "hubspot"
  | "salesforce"
  | "jira"
  | "sentry"
  | "notion";

const SUPPORTED_PROVIDERS = new Set<GenericWorkspaceOAuthProvider>([
  "figma",
  "gmail",
  "google_calendar",
  "google_docs",
  "google_drive",
  "google_sheets",
  "google_slides",
  "github",
  "hubspot",
  "salesforce",
  "jira",
  "sentry",
  "notion",
]);
const FLOW_TTL_SECONDS = 10 * 60;
const PROVIDER_REQUEST_TIMEOUT_MS = 10_000;
const PROVIDER_RESPONSE_MAX_BYTES = 256 * 1024;
const SALESFORCE_PRODUCTION_LOGIN_URL = "https://login.salesforce.com";
const SALESFORCE_SANDBOX_LOGIN_URL = "https://test.salesforce.com";
const WORKSPACE_OAUTH_ADMIN_ERROR =
  "This shared connection requires organization or app-admin access. Personal connections can be connected by any workspace member.";

export type WorkspaceProviderOAuthScope = "user" | "organization" | "app";

export function isWorkspaceProviderOAuthScope(
  value: unknown,
): value is WorkspaceProviderOAuthScope {
  return value === "user" || value === "organization" || value === "app";
}

export function isGoogleWorkspaceOAuthProvider(provider: string): boolean {
  return (
    provider === "gmail" ||
    provider === "google_calendar" ||
    provider === "google_docs" ||
    provider === "google_drive" ||
    provider === "google_sheets" ||
    provider === "google_slides"
  );
}

export function shouldUseRootGoogleOAuthCallback(
  provider: GenericWorkspaceOAuthProvider,
): boolean {
  return (
    isGoogleWorkspaceOAuthProvider(provider) &&
    (isWorkspaceOAuthCallbackRelayEnabled() || getAppBasePath() === "")
  );
}

export async function hasWorkspaceProviderOAuthCredentials(
  provider: GenericWorkspaceOAuthProvider,
): Promise<boolean> {
  const [clientId, clientSecret] =
    await resolveProviderClientCredentials(provider);
  return Boolean(clientId && clientSecret);
}

export interface WorkspaceProviderOAuthFlow {
  provider: GenericWorkspaceOAuthProvider;
  flowId: string;
  verifier: string;
  redirectUri: string;
  owner: string;
  orgId?: string;
  appId: string;
  scope: WorkspaceProviderOAuthScope;
  salesforceLoginUrl?: string;
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

/**
 * Fails an OAuth step in whatever form the caller can actually read.
 *
 * Both ends of this flow are top-level browser navigations —
 * `startWorkspaceProviderOAuth` assigns `window.location`, onboarding cards
 * link straight to `/start`, and the provider redirects the browser to
 * `/callback` — so a bare `{ error }` body replaces whatever the user was
 * looking at with raw JSON and no way back. On the callback that lands them
 * there *after* they have already consented. Anything asking for HTML gets the
 * error page the sign-in callbacks already use; a programmatic caller still
 * gets JSON and the same status.
 */
export function oauthFlowFailure(
  event: H3Event,
  status: number,
  message: string,
): Response | { error: string } {
  setResponseStatus(event, status);
  const accept = getRequestHeader(event, "accept") ?? "";
  if (!accept.includes("text/html")) return { error: message };
  return oauthErrorPage(message, status);
}

export async function handleWorkspaceProviderOAuthStart(
  event: H3Event,
  providerId: GenericWorkspaceOAuthProvider,
): Promise<Response | Record<string, unknown>> {
  if (getMethod(event) !== "GET") return methodNotAllowed(event);
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return unauthorized(event);
  const query = getQuery(event);
  const appId = normalizeAppId(
    text(query.appId) ?? getAppConfig().app.workspaceId ?? "creative-context",
  );
  const requestedScope = parseWorkspaceProviderOAuthScope(text(query.scope));
  if (!requestedScope) {
    return oauthFlowFailure(
      event,
      400,
      "OAuth connection scope must be user, organization, or app.",
    );
  }
  const orgContext = await requireWorkspaceProviderOAuthAccess(
    event,
    appId,
    requestedScope,
  );
  if (!orgContext) {
    return oauthFlowFailure(event, 403, WORKSPACE_OAUTH_ADMIN_ERROR);
  }
  const orgId = orgContext.orgId;
  if (!orgId) {
    return oauthFlowFailure(event, 403, WORKSPACE_OAUTH_ADMIN_ERROR);
  }
  const provider = requiredProvider(providerId);
  const salesforceLoginUrl =
    providerId === "salesforce"
      ? resolveSalesforceOAuthLoginUrl(text(query.environment))
      : undefined;
  if (providerId === "salesforce" && !salesforceLoginUrl) {
    return oauthFlowFailure(
      event,
      400,
      "Salesforce environment must be production or sandbox.",
    );
  }
  const useRootGoogleCallback = shouldUseRootGoogleOAuthCallback(providerId);
  const redirectUri = resolveOAuthRedirectUri(
    event,
    useRootGoogleCallback
      ? "/_agent-native/google/callback"
      : workspaceProviderOAuthPath(providerId, "callback"),
  );
  if (!redirectUri) {
    return oauthFlowFailure(event, 400, "Invalid OAuth redirect URI.");
  }
  if (useRootGoogleCallback) {
    let parsedRedirectUri: URL;
    try {
      parsedRedirectUri = new URL(redirectUri);
    } catch {
      return oauthFlowFailure(event, 400, "Invalid OAuth redirect URI.");
    }
    if (
      parsedRedirectUri.pathname !== "/_agent-native/google/callback" ||
      parsedRedirectUri.search ||
      parsedRedirectUri.hash
    ) {
      return oauthFlowFailure(
        event,
        400,
        "Google workspace OAuth must use the shared callback.",
      );
    }
  }
  return runWithRequestContext(
    { userEmail: session.email, orgId },
    async () => {
      const [clientId, clientSecret] =
        await resolveProviderClientCredentials(providerId);
      if (!clientId || !clientSecret) {
        return oauthFlowFailure(
          event,
          503,
          `${provider.label} OAuth client credentials are not configured.`,
        );
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
        orgId,
        app: appId,
        scope: orgContext.oauthScope,
        ...(useRootGoogleCallback ? { provider: providerId } : {}),
        returnUrl,
        flowId,
      });
      const flow: WorkspaceProviderOAuthFlow = {
        provider: providerId,
        flowId,
        verifier,
        redirectUri,
        owner: session.email,
        orgId,
        appId,
        scope: orgContext.oauthScope,
        ...(salesforceLoginUrl ? { salesforceLoginUrl } : {}),
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
        loginHint: session.email,
        ...(salesforceLoginUrl
          ? {
              authorizationUrl: salesforceOAuthEndpoint(
                salesforceLoginUrl,
                "authorize",
              ),
            }
          : {}),
      });
      return redirectWithStagedCookies(event, authorizationUrl);
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
  const flow = readStoredFlow(event, providerId);
  if (!flow || !isWorkspaceProviderOAuthScope(flow.scope)) {
    return oauthFlowFailure(event, 400, "OAuth state is invalid or expired.");
  }
  const orgContext = await requireWorkspaceProviderOAuthAccess(
    event,
    flow.appId,
    flow.scope,
  );
  if (!orgContext) {
    return oauthFlowFailure(event, 403, WORKSPACE_OAUTH_ADMIN_ERROR);
  }
  const orgId = orgContext.orgId;
  if (!orgId) {
    return oauthFlowFailure(event, 403, WORKSPACE_OAUTH_ADMIN_ERROR);
  }
  const query = getQuery(event);
  const code = text(query.code);
  const stateParam = text(query.state);
  const providerError = text(query.error);
  if (providerError) {
    return oauthFlowFailure(
      event,
      400,
      "OAuth authorization was not completed.",
    );
  }
  if (!code || !stateParam) {
    return oauthFlowFailure(
      event,
      400,
      "OAuth callback is missing code or state.",
    );
  }
  deleteCookie(event, flowCookieName(providerId), { path: "/" });
  const state = decodeOAuthState(stateParam, "");
  if (
    !flow ||
    !isWorkspaceProviderOAuthFlowValid({
      flow,
      state,
      provider: providerId,
      sessionEmail: session.email,
      sessionOrgId: orgId,
    })
  ) {
    return oauthFlowFailure(event, 400, "OAuth state is invalid or expired.");
  }
  const provider = requiredProvider(providerId);
  return runWithRequestContext(
    { userEmail: session.email, orgId },
    async () => {
      const [clientId, clientSecret] =
        await resolveProviderClientCredentials(providerId);
      if (!clientId || !clientSecret) {
        return oauthFlowFailure(
          event,
          503,
          `${provider.label} OAuth client credentials are not configured.`,
        );
      }
      const tokens = await exchangeWorkspaceProviderOAuthCode({
        providerId,
        provider,
        clientId,
        clientSecret,
        code,
        verifier: flow.verifier,
        redirectUri: flow.redirectUri,
        ...(providerId === "salesforce"
          ? {
              tokenUrl: salesforceOAuthEndpoint(
                flow.salesforceLoginUrl ?? SALESFORCE_PRODUCTION_LOGIN_URL,
                "token",
              ),
            }
          : {}),
      });
      const identities = await resolveWorkspaceProviderIdentities(
        providerId,
        tokens,
      );
      if (!identities.length) {
        throw new Error(
          `${provider.label} OAuth did not return an accessible account.`,
        );
      }
      const existingConnections = await listWorkspaceConnections({
        provider: providerId,
        includeDisabled: true,
      });
      for (const identity of identities) {
        const accountId = scopedOAuthAccountId(
          providerId,
          session.email,
          identity.accountId,
        );
        await saveOAuthTokens(
          provider.oauth!.provider,
          accountId,
          tokens,
          session.email,
        );
        await setOAuthDisplayName(
          provider.oauth!.provider,
          accountId,
          identity.label,
        );
        const existing = existingConnections.find(
          (connection) =>
            connection.accountId === accountId &&
            (flow.scope === "user"
              ? connection.allowedUsers.some(
                  (allowedUser) =>
                    allowedUser.toLowerCase() === session.email.toLowerCase(),
                )
              : flow.scope === "organization"
                ? connection.allowedUsers.length === 0 &&
                  (connection.allowedUserGroups?.length ?? 0) === 0
                : connection.allowedApps.some(
                    (allowedApp) =>
                      allowedApp.toLowerCase() === flow.appId.toLowerCase(),
                  )),
        );
        const scopes = mergeWorkspaceOAuthValues(
          existing?.scopes ?? [],
          identity.scopes ?? tokenScopes(tokens, provider.oauth!.scopes),
        );
        const connectionConfig = {
          credentialMode: "oauth",
          ...(providerId === "hubspot" ||
          providerId === "salesforce" ||
          providerId === "jira"
            ? { externalAccountId: identity.accountId }
            : {}),
          ...(identity.config ?? {}),
          ...(providerId === "salesforce"
            ? {
                salesforceLoginUrl:
                  flow.salesforceLoginUrl ?? SALESFORCE_PRODUCTION_LOGIN_URL,
              }
            : {}),
        };
        const connection = await upsertWorkspaceConnection({
          ...(existing ? { id: existing.id } : {}),
          provider: providerId,
          label: `${provider.label}: ${identity.label}`,
          accountId,
          accountLabel: identity.label,
          status: "connected",
          scopes,
          allowedApps:
            existing?.allowedApps ?? (flow.scope === "app" ? [flow.appId] : []),
          allowedUsers:
            flow.scope === "user"
              ? [session.email]
              : (existing?.allowedUsers ?? []),
          config: connectionConfig,
          lastCheckedAt: new Date(),
          lastError: null,
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: connection.id,
          appId: flow.appId,
          provider: providerId,
          scopes,
          config: connectionConfig,
        });
      }
      const returnPath =
        state.returnUrl ??
        `/settings/integrations?connected=${encodeURIComponent(providerId)}`;
      return redirectWithStagedCookies(event, getAppUrl(event, returnPath));
    },
  );
}

export function buildWorkspaceProviderAuthorizationUrl(input: {
  provider: WorkspaceConnectionProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  authorizationUrl?: string;
  loginHint?: string;
}): string {
  if (!input.provider.oauth)
    throw new Error("Provider does not support OAuth.");
  const url = new URL(
    input.authorizationUrl ?? input.provider.oauth.authorizationUrl,
  );
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (input.provider.id === "figma" || input.provider.id === "sentry") {
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (input.provider.id === "github") {
    url.searchParams.set("allow_signup", "true");
  }
  if (input.provider.id === "jira") {
    url.searchParams.set("audience", "api.atlassian.com");
    url.searchParams.set("prompt", "consent");
  }
  if (isGoogleWorkspaceOAuthProvider(input.provider.id)) {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent select_account");
    if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
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
  tokenUrl?: string;
}): Promise<Record<string, unknown>> {
  const tokenUrl = input.tokenUrl ?? input.provider.oauth?.tokenUrl;
  if (!tokenUrl) throw new Error("Provider does not support OAuth.");
  const authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`;
  if (input.providerId === "github") {
    const { response, body } = await fetchBoundedProviderJson(
      tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      },
      input.provider.label,
    );
    const accessToken = text(body.access_token);
    if (!response.ok || !accessToken) {
      throw new Error(
        `${input.provider.label} OAuth token exchange failed (${response.status}).`,
      );
    }
    return {
      ...body,
      ...(Number.isFinite(Number(body.expires_in)) &&
      Number(body.expires_in) > 0
        ? { expiry_date: Date.now() + Number(body.expires_in) * 1_000 }
        : {}),
    };
  }
  if (input.providerId === "hubspot") {
    const { response, body } = await fetchBoundedProviderJson(
      tokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      },
      input.provider.label,
    );
    const accessToken = text(body.access_token);
    if (!response.ok || !accessToken) {
      throw new Error(
        `${input.provider.label} OAuth token exchange failed (${response.status}).`,
      );
    }
    return {
      ...body,
      ...(Number.isFinite(Number(body.expires_in)) &&
      Number(body.expires_in) > 0
        ? { expiry_date: Date.now() + Number(body.expires_in) * 1_000 }
        : {}),
    };
  }
  if (input.providerId === "salesforce") {
    const { response, body } = await fetchBoundedProviderJson(
      tokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
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
  if (input.providerId === "jira") {
    const { response, body } = await fetchBoundedProviderJsonValue(
      tokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      },
      input.provider.label,
    );
    const tokenBody = record(body) ?? {};
    const accessToken = text(tokenBody.access_token);
    if (!response.ok || !accessToken) {
      throw new Error(
        `${input.provider.label} OAuth token exchange failed (${response.status}).`,
      );
    }
    const expiresIn = Number(tokenBody.expires_in);
    return {
      ...tokenBody,
      ...(Number.isFinite(expiresIn) && expiresIn > 0
        ? { expiry_date: Date.now() + expiresIn * 1_000 }
        : {}),
    };
  }
  const fields = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    ...(input.providerId === "figma" || input.providerId === "sentry"
      ? { code_verifier: input.verifier }
      : {}),
    ...(input.providerId === "sentry"
      ? { client_id: input.clientId, client_secret: input.clientSecret }
      : {}),
    ...(isGoogleWorkspaceOAuthProvider(input.providerId)
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
): Promise<WorkspaceProviderIdentity> {
  const [identity] = await resolveWorkspaceProviderIdentities(
    providerId,
    tokens,
  );
  if (!identity) {
    throw new Error(
      `${providerId} OAuth response did not identify an account.`,
    );
  }
  return identity;
}

export async function resolveWorkspaceProviderIdentities(
  providerId: GenericWorkspaceOAuthProvider,
  tokens: Record<string, unknown>,
): Promise<WorkspaceProviderIdentity[]> {
  if (providerId === "jira") {
    const accessToken = text(tokens.access_token);
    if (!accessToken) {
      throw new Error("Jira OAuth response did not include an access token.");
    }
    const { response, body } = await fetchBoundedProviderJsonValue(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "Jira",
    );
    if (!response.ok || !Array.isArray(body)) {
      throw new Error("Jira OAuth response did not identify accessible sites.");
    }
    return body.flatMap((resource) => {
      const entry = record(resource);
      const cloudId = text(entry?.id);
      const siteUrl = text(entry?.url);
      if (!cloudId || !siteUrl) return [];
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(siteUrl);
      } catch {
        return [];
      }
      if (
        parsedUrl.protocol !== "https:" ||
        !parsedUrl.hostname.endsWith(".atlassian.net")
      ) {
        return [];
      }
      const scopes = Array.isArray(entry?.scopes)
        ? entry.scopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : undefined;
      return [
        {
          accountId: cloudId,
          label: text(entry?.name) ?? parsedUrl.hostname,
          ...(scopes?.length ? { scopes } : {}),
          config: {
            atlassianCloudId: cloudId,
            atlassianApiBaseUrl: `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}`,
            siteUrl: parsedUrl.origin,
          },
        },
      ];
    });
  }
  return [await resolveWorkspaceProviderIdentitySingle(providerId, tokens)];
}

type WorkspaceProviderIdentity = {
  accountId: string;
  label: string;
  scopes?: string[];
  config?: Record<string, unknown>;
};

async function resolveWorkspaceProviderIdentitySingle(
  providerId: GenericWorkspaceOAuthProvider,
  tokens: Record<string, unknown>,
): Promise<WorkspaceProviderIdentity> {
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
  if (providerId === "github") {
    const accessToken = text(tokens.access_token)!;
    const { response, body: user } = await fetchBoundedProviderJson(
      "https://api.github.com/user",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      "GitHub",
    );
    const accountId = text(user.login) ?? text(user.id);
    if (!response.ok || !accountId) {
      throw new Error(
        "GitHub OAuth response did not identify the connected user.",
      );
    }
    return {
      accountId,
      label: text(user.name) ?? text(user.login) ?? "GitHub account",
    };
  }
  if (providerId === "hubspot") {
    const accessToken = text(tokens.access_token)!;
    const { response, body } = await fetchBoundedProviderJson(
      `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`,
      { headers: { Accept: "application/json" } },
      "HubSpot",
    );
    const accountId = scalarText(body.hub_id) ?? scalarText(body.user_id);
    if (!response.ok || !accountId) {
      throw new Error(
        "HubSpot OAuth response did not identify the connected portal.",
      );
    }
    return {
      accountId,
      label: text(body.hub_domain) ?? `HubSpot portal ${accountId}`,
    };
  }
  if (providerId === "salesforce") {
    const instanceUrl = normalizeSalesforceInstanceUrl(
      text(tokens.instance_url),
    );
    const identity = parseSalesforceIdentityUrl(text(tokens.id));
    if (!instanceUrl || !identity) {
      throw new Error(
        "Salesforce OAuth response did not identify the connected organization.",
      );
    }
    return {
      accountId: identity.organizationId,
      label: instanceUrl.hostname,
      config: {
        salesforceInstanceUrl: instanceUrl.origin,
        salesforceIdentityUrl: identity.url.href,
        salesforceOrganizationId: identity.organizationId,
      },
    };
  }
  if (providerId === "sentry") {
    const accessToken = text(tokens.access_token)!;
    const { response, body: user } = await fetchBoundedProviderJson(
      "https://sentry.io/api/0/users/me/",
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "Sentry",
    );
    const accountId = text(user.id);
    if (!response.ok || !accountId) {
      throw new Error(
        "Sentry OAuth response did not identify the connected account.",
      );
    }
    return {
      accountId,
      label: text(user?.email) ?? text(user?.name) ?? "Sentry account",
    };
  }
  if (isGoogleWorkspaceOAuthProvider(providerId)) {
    const accessToken = text(tokens.access_token)!;
    const { response, body } = await fetchBoundedProviderJson(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "Google Workspace",
    );
    const accountId = text(body.email) ?? text(body.sub);
    if (!response.ok || !accountId) {
      throw new Error(
        "Google OAuth response did not identify the connected account.",
      );
    }
    return {
      accountId,
      label: text(body.email) ?? text(body.name) ?? "Google account",
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
    input.state.scope === input.flow.scope &&
    (input.state.provider === undefined ||
      input.state.provider === input.provider) &&
    input.sessionEmail === input.flow.owner &&
    input.state.orgId === input.flow.orgId &&
    input.sessionOrgId === input.flow.orgId &&
    input.state.app === input.flow.appId
  );
}

export function canConnectWorkspaceProviderOAuth(
  orgId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return Boolean(orgId) && (role === "owner" || role === "admin");
}

export function scopedOAuthAccountId(
  provider: GenericWorkspaceOAuthProvider,
  owner: string,
  accountId: string,
): string {
  if (
    provider !== "hubspot" &&
    provider !== "salesforce" &&
    provider !== "jira"
  ) {
    return accountId;
  }
  const ownerKey = crypto
    .createHash("sha256")
    .update(`${provider}:${owner.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
  return `${accountId}::${ownerKey}`;
}

async function fetchBoundedProviderJson(
  url: string,
  init: RequestInit,
  providerLabel: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const { response, body } = await fetchBoundedProviderJsonValue(
    url,
    init,
    providerLabel,
  );
  return { response, body: record(body) ?? {} };
}

async function fetchBoundedProviderJsonValue(
  url: string,
  init: RequestInit,
  providerLabel: string,
): Promise<{ response: Response; body: unknown }> {
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
    return { response, body };
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

function clientCredentialKeys(
  provider: GenericWorkspaceOAuthProvider,
  field: "id" | "secret",
): string[] {
  const prefix = isGoogleWorkspaceOAuthProvider(provider)
    ? "GOOGLE"
    : provider.toUpperCase();
  const suffix = field === "id" ? "ID" : "SECRET";
  if (provider === "github") {
    const integrationPrefix = `GITHUB_INTEGRATION_CLIENT_${suffix}`;
    return [integrationPrefix, `GITHUB_CLIENT_${suffix}`];
  }
  if (provider === "hubspot") {
    const integrationPrefix = `HUBSPOT_INTEGRATION_CLIENT_${suffix}`;
    return [integrationPrefix, `HUBSPOT_CLIENT_${suffix}`];
  }
  if (provider === "salesforce") {
    const integrationPrefix = `SALESFORCE_INTEGRATION_CLIENT_${suffix}`;
    const consumerCredential = `SALESFORCE_CONSUMER_${
      field === "id" ? "KEY" : "SECRET"
    }`;
    return [
      integrationPrefix,
      `SALESFORCE_CLIENT_${suffix}`,
      consumerCredential,
    ];
  }
  return [`${prefix}_CLIENT_${suffix}`];
}

function normalizeSalesforceInstanceUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (host !== "salesforce.com" && !host.endsWith(".salesforce.com"))
    ) {
      return null;
    }
    return new URL(url.origin);
  } catch {
    return null;
  }
}

function parseSalesforceIdentityUrl(
  value: string | undefined,
): { organizationId: string; url: URL } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (host !== "salesforce.com" && !host.endsWith(".salesforce.com"))
    ) {
      return null;
    }
    const match = url.pathname.match(/^\/id\/([^/]+)\/[^/]+\/?$/);
    if (!match?.[1]) return null;
    return { organizationId: match[1], url };
  } catch {
    return null;
  }
}

export function resolveSalesforceOAuthLoginUrl(
  environment: string | undefined,
): string | null {
  const normalized = environment?.trim().toLowerCase();
  if (!normalized || normalized === "production") {
    return SALESFORCE_PRODUCTION_LOGIN_URL;
  }
  if (normalized === "sandbox") return SALESFORCE_SANDBOX_LOGIN_URL;
  return null;
}

export function salesforceOAuthEndpoint(
  loginUrl: string,
  phase: "authorize" | "token",
): string {
  if (
    loginUrl !== SALESFORCE_PRODUCTION_LOGIN_URL &&
    loginUrl !== SALESFORCE_SANDBOX_LOGIN_URL
  ) {
    throw new Error("Invalid Salesforce OAuth login URL.");
  }
  return `${loginUrl}/services/oauth2/${phase}`;
}

async function resolveProviderClientCredentials(
  provider: GenericWorkspaceOAuthProvider,
): Promise<[string | null, string | null]> {
  const [clientId, clientSecret] = await Promise.all(
    (["id", "secret"] as const).map(async (field) => {
      for (const key of clientCredentialKeys(provider, field)) {
        const value = await resolveSecret(key);
        if (value) return value;
      }
      return null;
    }),
  );
  return [clientId, clientSecret];
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

function parseWorkspaceProviderOAuthScope(
  value: string | undefined,
): WorkspaceProviderOAuthScope | null {
  if (value === undefined) return "organization";
  return isWorkspaceProviderOAuthScope(value) ? value : null;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function methodNotAllowed(event: H3Event) {
  return oauthFlowFailure(event, 405, "Method not allowed");
}

/**
 * Losing the session mid-flow is the most likely way a real user reaches this,
 * and it happens on a navigation — so it needs the same readable page as every
 * other failure here rather than a bare 401 body.
 */
function unauthorized(event: H3Event) {
  return oauthFlowFailure(event, 401, "Authentication required");
}

async function requireWorkspaceProviderOAuthAccess(
  event: H3Event,
  appId?: string,
  requestedScope: WorkspaceProviderOAuthScope = "organization",
): Promise<
  | (Awaited<ReturnType<typeof getOrgContext>> & {
      oauthScope: WorkspaceProviderOAuthScope;
    })
  | null
> {
  const context = await getOrgContext(event).catch(() => null);
  if (!context || !context.orgId) {
    setResponseStatus(event, 403);
    return null;
  }
  if (requestedScope === "user") {
    return { ...context, oauthScope: "user" };
  }
  if (
    requestedScope === "organization" &&
    canConnectWorkspaceProviderOAuth(context.orgId, context.role)
  ) {
    return { ...context, oauthScope: "organization" };
  }
  if (
    requestedScope === "app" &&
    canConnectWorkspaceProviderOAuth(context.orgId, context.role)
  ) {
    return { ...context, oauthScope: "app" };
  }
  if (appId) {
    const descriptor = getRegisteredAppRoles(appId);
    if (descriptor?.roles.some((role) => role === "admin")) {
      const role = await resolveAppRole(descriptor, {
        userEmail: context.email,
        orgId: context.orgId,
      });
      if (role.status === "assigned" && role.role === "admin") {
        return { ...context, oauthScope: "app" };
      }
    }
  }
  setResponseStatus(event, 403);
  return null;
}
