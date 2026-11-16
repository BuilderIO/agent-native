import {
  SLACK_AUTHORIZE_URL,
  type SlackOAuthAccessResponse,
} from "./slack-oauth.js";

const USER_OAUTH_ERROR = "User authorization request is invalid.";
const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const FUNCTIONAL_SCOPE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const MAX_TOKEN_LENGTH = 65_536;
const MAX_SCOPES = 256;
const MAX_CLIENT_ID_LENGTH = 512;
const MAX_STATE_LENGTH = 4_096;

/**
 * Read-only user scopes for a connected, user-authorized Slack client.
 * No write scope is requested here: provider writes stay out of the first
 * connected slices, and adding one later is a deliberate scope change.
 */
export const SLACK_USER_READ_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "search:read",
  "team:read",
  "users:read",
] as const;

export interface SlackUserAuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  userScopes: readonly string[];
  teamId?: string;
}

export interface SlackUserTokenBundle {
  accessToken: string;
  refreshToken?: string;
  tokenType: "user";
  expiresAt?: number;
  scopes: string[];
}

export interface SlackUserOAuthIdentity {
  teamId: string;
  apiAppId: string;
  externalUserId: string;
  bundle: SlackUserTokenBundle;
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_ID.test(value);
}

function isFunctionalScope(value: unknown): value is string {
  return typeof value === "string" && FUNCTIONAL_SCOPE.test(value);
}

function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TOKEN_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function normalizeScopes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = new Set<string>();
  for (const scope of value) {
    if (!isFunctionalScope(scope)) return null;
    scopes.add(scope);
    if (scopes.size > MAX_SCOPES) return null;
  }
  if (scopes.size > MAX_SCOPES) return null;
  return [...scopes].sort();
}

function parseScopeList(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const scopes = new Set<string>();
  for (const part of value.split(",")) {
    const scope = part.trim();
    if (!scope) continue;
    if (!isFunctionalScope(scope)) return null;
    scopes.add(scope);
    if (scopes.size > MAX_SCOPES) return null;
  }
  if (scopes.size === 0) return null;
  return [...scopes].sort();
}

function isHttpsRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    // coercion-ok: an unparseable redirect is rejected by the caller's throw.
    return false;
  }
}

/**
 * Build the user-scope-only Slack authorization URL. This intentionally omits
 * the bot `scope` parameter so the request cannot silently add bot grants.
 */
export function buildSlackUserAuthorizeUrl(
  options: SlackUserAuthorizeUrlOptions,
): string {
  const clientId =
    typeof options.clientId === "string" ? options.clientId.trim() : "";
  const state = typeof options.state === "string" ? options.state : "";
  const redirectUri = options.redirectUri;
  const scopes = normalizeScopes(options.userScopes);
  const teamId = options.teamId;

  if (
    !clientId ||
    clientId.length > MAX_CLIENT_ID_LENGTH ||
    !state.trim() ||
    state.length > MAX_STATE_LENGTH ||
    !isHttpsRedirect(redirectUri) ||
    !scopes
  ) {
    throw new Error(USER_OAUTH_ERROR);
  }
  if (teamId !== undefined && !isBoundedId(teamId)) {
    throw new Error(USER_OAUTH_ERROR);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    user_scope: scopes.join(","),
  });
  if (teamId !== undefined) params.set("team", teamId);
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Map a successful Slack OAuth response to the user token bundle only. Bot
 * tokens, team names, and any other provider fields are never copied, and a
 * missing optional credential stays truly absent.
 */
export function mapSlackUserOAuthResponse(
  response: SlackOAuthAccessResponse,
  now = Date.now(),
): SlackUserOAuthIdentity {
  if (response.ok !== true || !isPositiveSafeInteger(now)) {
    throw new Error(USER_OAUTH_ERROR);
  }

  const appId = response.app_id;
  const teamId = response.team?.id;
  const userId = response.authed_user?.id;
  const accessToken = response.authed_user?.access_token;
  const tokenType = response.authed_user?.token_type;
  const refreshToken = response.authed_user?.refresh_token;
  const expiresIn = response.authed_user?.expires_in;

  if (
    !isBoundedId(appId) ||
    !isBoundedId(teamId) ||
    !isBoundedId(userId) ||
    !isToken(accessToken) ||
    tokenType !== "user"
  ) {
    throw new Error(USER_OAUTH_ERROR);
  }

  const scopes = parseScopeList(response.authed_user?.scope);
  if (!scopes) throw new Error(USER_OAUTH_ERROR);
  // Slack can return scopes this app was granted earlier. A token with any
  // scope outside the read-only set would let a consumer write unknowingly.
  const allowed = new Set<string>(SLACK_USER_READ_SCOPES);
  if (!scopes.every((scope) => allowed.has(scope))) {
    throw new Error(USER_OAUTH_ERROR);
  }

  const bundle: SlackUserTokenBundle = {
    accessToken,
    tokenType: "user",
    scopes,
  };

  if (refreshToken !== undefined) {
    if (!isToken(refreshToken)) throw new Error(USER_OAUTH_ERROR);
    bundle.refreshToken = refreshToken;
  }

  if (expiresIn !== undefined) {
    if (!isPositiveSafeInteger(expiresIn)) {
      throw new Error(USER_OAUTH_ERROR);
    }
    const expiresAt = now + expiresIn * 1_000;
    if (!isPositiveSafeInteger(expiresAt)) {
      throw new Error(USER_OAUTH_ERROR);
    }
    bundle.expiresAt = expiresAt;
  }

  return {
    teamId,
    apiAppId: appId,
    externalUserId: userId,
    bundle,
  };
}
