/** Slack OAuth v2 helpers for managed Agent Native messaging installs. */

import type { SecretScope } from "../secrets/register.js";
import type {
  IntegrationInstallationHealth,
  UpsertIntegrationInstallationInput,
} from "./installations-store.js";

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";

/** Scopes needed for contextual, file-aware Agent Native conversations. */
export const SLACK_AGENT_BOT_SCOPES = [
  "assistant:write",
  "app_mentions:read",
  "channels:read",
  "channels:history",
  "chat:write",
  "files:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "pins:read",
  "reactions:read",
  "users:read",
  "users:read.email",
] as const;

export interface SlackOAuthAccessResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  is_enterprise_install?: boolean;
  authed_user?: { id?: string };
  team?: { id?: string; name?: string } | null;
  enterprise?: { id?: string; name?: string } | null;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  team_id?: string;
  team?: string;
  enterprise_id?: string;
  enterprise?: string;
  user_id?: string;
  bot_id?: string;
  url?: string;
}

export interface SlackAuthHealth {
  ok: boolean;
  health: IntegrationInstallationHealth;
  error: string | null;
  checkedAt: number;
  teamId: string | null;
  enterpriseId: string | null;
  botId: string | null;
  userId: string | null;
}

export interface SlackInstallSession {
  email?: string | null;
  orgId?: string | null;
  orgRole?: string | null;
}

export interface SlackInstallAccess {
  ownerEmail: string;
  orgId: string | null;
  secretScope: SecretScope;
  secretScopeId: string;
}

function safeSlackError(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z0-9_.-]{1,100}$/i.test(value)
    ? value
    : fallback;
}

export function buildSlackAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  userScopes?: readonly string[];
  teamId?: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: (options.scopes ?? SLACK_AGENT_BOT_SCOPES).join(","),
    state: options.state,
  });
  if (options.userScopes?.length) {
    params.set("user_scope", options.userScopes.join(","));
  }
  if (options.teamId) params.set("team", options.teamId);
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchange an OAuth code using Slack's preferred HTTP Basic authentication. */
export async function exchangeSlackOAuthCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOAuthAccessResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authorization = Buffer.from(
    `${options.clientId}:${options.clientSecret}`,
    "utf8",
  ).toString("base64");
  const response = await fetchImpl(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
  });
  const data = (await response
    .json()
    .catch(() => null)) as SlackOAuthAccessResponse | null;
  if (!response.ok || !data?.ok) {
    throw new Error(
      safeSlackError(
        data?.error,
        `Slack OAuth exchange failed (${response.status})`,
      ),
    );
  }
  return data;
}

/**
 * Rotate an expiring Slack token. Slack refresh tokens are one-time-use, so
 * callers must atomically persist the returned access/refresh pair together.
 */
export async function refreshSlackOAuthToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOAuthAccessResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authorization = Buffer.from(
    `${options.clientId}:${options.clientSecret}`,
    "utf8",
  ).toString("base64");
  const response = await fetchImpl(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
    }),
  });
  const data = (await response
    .json()
    .catch(() => null)) as SlackOAuthAccessResponse | null;
  if (!response.ok || !data?.ok) {
    throw new Error(
      safeSlackError(
        data?.error,
        `Slack OAuth token refresh failed (${response.status})`,
      ),
    );
  }
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Slack OAuth token refresh returned an incomplete bundle");
  }
  return data;
}

/** Validate a bot token without ever including it in an error or result. */
export async function testSlackAuth(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SlackAuthHealth> {
  const checkedAt = Date.now();
  try {
    const response = await fetchImpl(SLACK_AUTH_TEST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await response
      .json()
      .catch(() => null)) as SlackApiResponse | null;
    if (!response.ok || !data?.ok) {
      const error = safeSlackError(
        data?.error,
        `Slack auth test failed (${response.status})`,
      );
      return {
        ok: false,
        health:
          error === "invalid_auth" || error === "token_revoked"
            ? "revoked"
            : "degraded",
        error,
        checkedAt,
        teamId: null,
        enterpriseId: null,
        botId: null,
        userId: null,
      };
    }
    return {
      ok: true,
      health: "healthy",
      error: null,
      checkedAt,
      teamId: data.team_id ?? null,
      enterpriseId: data.enterprise_id ?? null,
      botId: data.bot_id ?? null,
      userId: data.user_id ?? null,
    };
  } catch {
    return {
      ok: false,
      health: "degraded",
      error: "Slack auth test request failed",
      checkedAt,
      teamId: null,
      enterpriseId: null,
      botId: null,
      userId: null,
    };
  }
}

/** Stable team/app key used by webhook payloads and the installation store. */
export function slackInstallationKey(input: {
  teamId?: string | null;
  enterpriseId?: string | null;
  apiAppId?: string | null;
  isEnterpriseInstall?: boolean;
}): string {
  const workspaceId = input.isEnterpriseInstall
    ? input.enterpriseId
    : (input.teamId ?? input.enterpriseId);
  if (!workspaceId) {
    throw new Error("Slack OAuth did not return a team or enterprise id");
  }
  return `${input.isEnterpriseInstall ? "enterprise" : "team"}:${workspaceId}:app:${input.apiAppId || "default"}`;
}

/**
 * Convert a successful Slack response to the generic managed-install input.
 * The returned token bundle is server-only and must be passed directly to the
 * encrypted installation store, never to a route response.
 */
export function slackOAuthResponseToInstallation(
  response: SlackOAuthAccessResponse,
  access: SlackInstallAccess,
  now = Date.now(),
): UpsertIntegrationInstallationInput {
  if (!response.ok || !response.access_token) {
    throw new Error("Slack OAuth response did not include a bot access token");
  }
  const installationKey = slackInstallationKey({
    teamId: response.team?.id,
    enterpriseId: response.enterprise?.id,
    apiAppId: response.app_id,
    isEnterpriseInstall: response.is_enterprise_install,
  });
  const expiresAt =
    typeof response.expires_in === "number" && response.expires_in > 0
      ? now + response.expires_in * 1000
      : undefined;
  return {
    platform: "slack",
    installationKey,
    teamId: response.team?.id ?? null,
    teamName: response.team?.name ?? null,
    enterpriseId: response.enterprise?.id ?? null,
    enterpriseName: response.enterprise?.name ?? null,
    isEnterpriseInstall: response.is_enterprise_install === true,
    apiAppId: response.app_id ?? null,
    botUserId: response.bot_user_id ?? null,
    scopes: response.scope?.split(",").map((scope) => scope.trim()) ?? [],
    installedByExternalUserId: response.authed_user?.id ?? null,
    ownerEmail: access.ownerEmail,
    orgId: access.orgId,
    secretScope: access.secretScope,
    secretScopeId: access.secretScopeId,
    tokenBundle: {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresAt,
    },
    tokenExpiresAt: expiresAt ?? null,
  };
}

/**
 * Pure session/role gate for OAuth install routes. The caller must supply a
 * server-verified session; org membership must be the active org context.
 */
export function assertSlackInstallAccess(
  session: SlackInstallSession | null | undefined,
): SlackInstallAccess {
  const ownerEmail = session?.email?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("Sign in before connecting Slack.");
  const orgId = session?.orgId?.trim() || null;
  if (!orgId) {
    return {
      ownerEmail,
      orgId: null,
      secretScope: "user",
      secretScopeId: ownerEmail,
    };
  }
  if (session?.orgRole !== "owner" && session?.orgRole !== "admin") {
    throw new Error("Only organization owners and admins can connect Slack.");
  }
  return {
    ownerEmail,
    orgId,
    secretScope: "org",
    secretScopeId: orgId,
  };
}
