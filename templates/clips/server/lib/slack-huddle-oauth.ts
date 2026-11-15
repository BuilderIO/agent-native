/**
 * "Connect Slack for huddles".
 *
 * A per-user Slack OAuth on the same Slack app as link previews, asking only
 * for user scopes (SLACK_HUDDLE_USER_SCOPES). The user token lets Clips read
 * the huddle messages the person can see and look up who was in a huddle. It
 * is stored encrypted per Clips user in app_secrets, like the bot token.
 *
 * It shares the Slack app's redirect URL (/api/slack/oauth/callback), which
 * tells the two flows apart by the `app` in the OAuth state, so the Slack app
 * needs no extra redirect URL.
 */
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { writeAppState } from "@agent-native/core/application-state";
import { exchangeSlackOAuthCode } from "@agent-native/core/integrations";
import {
  deleteAppSecret,
  readAppSecret,
  writeAppSecret,
} from "@agent-native/core/secrets";
import {
  encodeOAuthState,
  getSession,
  isElectron,
  oauthCallbackResponse,
  oauthErrorPage,
  resolveOAuthRedirectUri,
  safeReturnPath,
  type OAuthStatePayload,
} from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { and, desc, eq, sql } from "drizzle-orm";
import { deleteCookie, getCookie, getQuery, setCookie, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import { shareStoppedMeetingWithHuddleParticipants } from "./meeting-participant-shares.js";
import { getActiveOrganizationId, sameOwnerEmail } from "./recordings.js";
import { SLACK_HUDDLE_USER_SCOPES, SlackTokenError } from "./slack-huddles.js";
import type { HuddleDeps, SlackUserConnection } from "./slack-huddles-store.js";

export const CLIPS_SLACK_HUDDLES_OAUTH_APP_ID = `${
  process.env.APP_NAME || "clips"
}:slack-huddles`;

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

/**
 * Binds a "Connect Slack for huddles" flow to the browser that started it.
 * /api/slack/huddles/install puts a random nonce in this httpOnly cookie and
 * its hash in the signed state; the callback only stores a token when the
 * same browser brings the cookie back and is signed in as the state's owner.
 */
/**
 * core's AppSecretDecryptionError: the stored secret exists but can never be
 * decrypted (key rotated or lost). It is not exported from
 * @agent-native/core/secrets, so it is recognized by its name and code.
 */
export function isSecretDecryptionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { name, errorCode } = err as { name?: unknown; errorCode?: unknown };
  return (
    name === "AppSecretDecryptionError" || errorCode === "app_secret_unreadable"
  );
}

export const SLACK_HUDDLES_OAUTH_COOKIE = "clips_slack_huddles_oauth";
const SLACK_HUDDLES_OAUTH_TTL_SECONDS = 10 * 60;

function hashFlowNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url");
}

function sameFlowHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Why a callback may not store a token for this state, or null when it may:
 * the browser must hold the flow cookie that matches the signed state, and
 * have a Clips session for the person who started the flow.
 */
export function slackHuddlesCallbackRejection(options: {
  state: OAuthStatePayload;
  sessionEmail: string | null | undefined;
  flowNonce: string | null | undefined;
}): string | null {
  const { state, sessionEmail, flowNonce } = options;
  if (!state.owner || !state.flowId) {
    return "Start the Slack connection from Clips Settings so it can be linked to your account.";
  }
  if (!flowNonce || !sameFlowHash(hashFlowNonce(flowNonce), state.flowId)) {
    return "This Slack connection was started in another browser. Start it again from Clips Settings in this browser.";
  }
  if (!sessionEmail) {
    return "Sign in to Clips in this browser, then start the Slack connection again from Settings.";
  }
  if (!sameOwnerEmail(sessionEmail, state.owner)) {
    return "You are signed in as someone else than the person who started this Slack connection.";
  }
  return null;
}

export type SlackHuddleConnectionListItem = {
  id: string;
  teamId: string;
  teamName: string | null;
  slackUserId: string;
  status: string;
  lastError: string | null;
  updatedAt: string;
};

export function isSlackHuddlesConnectState(state: OAuthStatePayload): boolean {
  return state.app === CLIPS_SLACK_HUDDLES_OAUTH_APP_ID;
}

export function slackHuddleTokenKey(
  teamId: string,
  slackUserId: string,
): string {
  return `clips-slack-huddles:${teamId}:${slackUserId}:user-token`;
}

/** Slack's authorize URL for user scopes only (no bot scopes asked again). */
export function buildSlackHuddlesAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    user_scope: SLACK_HUDDLE_USER_SCOPES.join(","),
    state: options.state,
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

export async function buildSlackHuddlesInstallUrl(
  event: H3Event,
): Promise<string | Response> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage(
      "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, then try again.",
    );
  }

  const redirectUri = resolveOAuthRedirectUri(
    event,
    "/api/slack/oauth/callback",
  );
  if (!redirectUri) {
    return oauthErrorPage("Slack OAuth redirect URL is not allowed.");
  }

  const session = await getSession(event);
  const owner = session?.email;
  if (!owner) {
    return oauthErrorPage("Sign in to Clips before connecting Slack.");
  }

  const query = getQuery(event);
  const desktop =
    isElectron(event) || query.desktop === "1" || query.desktop === "true";
  const requestedReturn =
    typeof query.return === "string"
      ? safeReturnPath(query.return)
      : "/settings";
  const flowNonce = randomBytes(32).toString("base64url");
  setCookie(event, SLACK_HUDDLES_OAUTH_COOKIE, flowNonce, {
    httpOnly: true,
    secure: redirectUri.startsWith("https://"),
    // Lax: the cookie must ride Slack's top-level redirect back to Clips.
    sameSite: "lax",
    path: "/",
    maxAge: SLACK_HUDDLES_OAUTH_TTL_SECONDS,
  });
  const state = encodeOAuthState({
    redirectUri,
    owner,
    desktop,
    addAccount: true,
    app: CLIPS_SLACK_HUDDLES_OAUTH_APP_ID,
    flowId: hashFlowNonce(flowNonce),
    returnUrl: requestedReturn !== "/" ? requestedReturn : "/settings",
  });

  return buildSlackHuddlesAuthorizeUrl({ clientId, redirectUri, state });
}

type AuthedUser = { id: string; accessToken: string; scope: string | null };

/** The user token part of Slack's oauth.v2.access answer, if it has one. */
export function readAuthedUser(response: unknown): AuthedUser | null {
  if (!response || typeof response !== "object") return null;
  const authed = (response as { authed_user?: unknown }).authed_user;
  if (!authed || typeof authed !== "object") return null;
  const { id, access_token, scope } = authed as Record<string, unknown>;
  if (typeof id !== "string" || typeof access_token !== "string") return null;
  if (!id || !access_token) return null;
  return {
    id,
    accessToken: access_token,
    scope: typeof scope === "string" ? scope : null,
  };
}

async function upsertConnection(options: {
  ownerEmail: string;
  orgId: string | null;
  teamId: string;
  teamName: string | null;
  slackUserId: string;
  tokenSecretRef: string;
  scope: string | null;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const values = {
    ownerEmail: options.ownerEmail,
    orgId: options.orgId,
    teamName: options.teamName,
    tokenSecretRef: options.tokenSecretRef,
    scope: options.scope,
    status: "connected" as const,
    lastError: null,
    updatedAt: nowIso,
  };
  await getDb()
    .insert(schema.slackUserConnections)
    .values({
      id: randomUUID(),
      teamId: options.teamId,
      slackUserId: options.slackUserId,
      createdAt: nowIso,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        schema.slackUserConnections.teamId,
        schema.slackUserConnections.slackUserId,
      ],
      set: values,
    });
}

export async function handleSlackHuddlesOAuthCallback(
  event: H3Event,
  state: OAuthStatePayload,
) {
  const query = getQuery(event);
  // One flow, one callback: the nonce is spent whatever happens next.
  const flowNonce = getCookie(event, SLACK_HUDDLES_OAUTH_COOKIE);
  deleteCookie(event, SLACK_HUDDLES_OAUTH_COOKIE, { path: "/" });

  const slackError = query.error as string | undefined;
  if (slackError) {
    return oauthErrorPage(`Slack connection failed: ${slackError}`);
  }
  // The token is only stored for the Clips user and browser that started the
  // flow: a live session for the state's owner plus the flow cookie.
  const session = await getSession(event);
  const rejection = slackHuddlesCallbackRejection({
    state,
    sessionEmail: session?.email,
    flowNonce,
  });
  if (rejection || !session?.email) {
    return oauthErrorPage(rejection ?? "Sign in to Clips first.");
  }
  const userEmail = session.email;

  const code = query.code as string | undefined;
  if (!code) return oauthErrorPage("Missing authorization code from Slack.");

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage(
      "Slack OAuth is not configured (missing client id/secret).",
    );
  }

  try {
    return await runWithRequestContext({ userEmail }, async () => {
      const tokens = await exchangeSlackOAuthCode({
        code,
        clientId,
        clientSecret,
        redirectUri: state.redirectUri,
      });
      const teamId = tokens.team?.id;
      const user = readAuthedUser(tokens);
      if (!teamId || !user) {
        return oauthErrorPage(
          "Slack did not return the user token needed for huddles.",
        );
      }

      const tokenKey = slackHuddleTokenKey(teamId, user.id);
      const teamName = tokens.team?.name ?? null;
      await writeAppSecret({
        key: tokenKey,
        value: user.accessToken,
        scope: "user",
        scopeId: userEmail,
        description: `Slack user token for huddles in ${teamName ?? teamId}`,
      });
      await upsertConnection({
        ownerEmail: userEmail,
        orgId: await getActiveOrganizationId(event).catch(() => null),
        teamId,
        teamName,
        slackUserId: user.id,
        tokenSecretRef: tokenKey,
        scope: user.scope,
      });

      await writeAppState("refresh-signal", { ts: Date.now() });
      return oauthCallbackResponse(event, teamName ?? teamId, {
        desktop: state.desktop,
        addAccount: true,
        returnUrl: state.returnUrl,
        appName: "Clips",
      });
    });
  } catch (err) {
    return oauthErrorPage(
      `Slack connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

const listColumns = {
  id: schema.slackUserConnections.id,
  teamId: schema.slackUserConnections.teamId,
  teamName: schema.slackUserConnections.teamName,
  slackUserId: schema.slackUserConnections.slackUserId,
  status: schema.slackUserConnections.status,
  lastError: schema.slackUserConnections.lastError,
  updatedAt: schema.slackUserConnections.updatedAt,
};

/** The signed-in person's own huddle connections. Tokens are never returned. */
export async function listSlackHuddleConnections(
  userEmail: string,
): Promise<SlackHuddleConnectionListItem[]> {
  return getDb()
    .select(listColumns)
    .from(schema.slackUserConnections)
    .where(
      and(
        sql`lower(${schema.slackUserConnections.ownerEmail}) = ${userEmail.trim().toLowerCase()}`,
        sql`${schema.slackUserConnections.status} <> 'disconnected'`,
      ),
    )
    .orderBy(desc(schema.slackUserConnections.updatedAt));
}

/**
 * Revoke a Slack user token. Resolves when Slack revoked it or no longer
 * accepts it; throws when that is not confirmed (network, outage, rate limit).
 */
export async function revokeSlackUserToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  type RevokeAnswer = { ok?: unknown; error?: unknown } | null;
  let response: Response;
  try {
    response = await fetchImpl("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(
      `Slack could not be reached to revoke the token: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // coercion-ok: a non-JSON answer is handled as an unconfirmed revoke below.
  const body = (await response.json().catch(() => null)) as RevokeAnswer;
  const status = response.status;
  if (body?.ok === true) return;
  const error = typeof body?.error === "string" ? body.error : `http_${status}`;
  // A token Slack no longer accepts is already as good as revoked.
  if (SlackTokenError.isTokenError(error)) return;
  throw new Error(`Slack did not revoke the token: ${error}`);
}

/**
 * Disconnect one of your own huddle connections: revoke and forget the token.
 * The token is only deleted once Slack confirmed the revoke (or no longer
 * accepts it), so a failed revoke can be retried instead of leaving a live
 * token Clips can no longer reach.
 */
export async function disconnectSlackHuddleConnection(options: {
  id: string;
  userEmail: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.slackUserConnections)
    .where(eq(schema.slackUserConnections.id, options.id))
    .limit(1);
  if (!row || !sameOwnerEmail(row.ownerEmail, options.userEmail)) return false;

  const secretRef = {
    key: row.tokenSecretRef,
    scope: "user" as const,
    scopeId: row.ownerEmail,
  };
  let secret: Awaited<ReturnType<typeof readAppSecret>>;
  try {
    secret = await readAppSecret(secretRef);
  } catch (err) {
    // A token that can never be decrypted can never be revoked either:
    // forget it so the person can disconnect (and reconnect). Any other read
    // failure may pass, so it is reported and the connection kept.
    if (!isSecretDecryptionError(err)) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not read the stored Slack token. Try again. (${reason})`,
      );
    }
    secret = null;
  }
  if (secret?.value) {
    try {
      await revokeSlackUserToken(secret.value, options.fetchImpl);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.slackUserConnections)
        .set({ lastError: reason, updatedAt: new Date().toISOString() })
        .where(eq(schema.slackUserConnections.id, row.id));
      throw new Error(`${reason}. The connection was kept; try again.`);
    }
  }
  // The connection only counts as disconnected once the token is gone: a
  // failed delete throws, the row stays connected and the user can retry.
  try {
    await deleteAppSecret(secretRef);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not delete the stored Slack token. Try again. (${reason})`,
    );
  }

  await db
    .update(schema.slackUserConnections)
    .set({
      status: "disconnected",
      lastError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.slackUserConnections.id, row.id));
  await writeAppState("refresh-signal", { ts: Date.now() });
  return true;
}

export async function readConnectionToken(
  connection: SlackUserConnection,
): Promise<string | null> {
  // Null when the secret is gone; SlackTokenError("token_unreadable") when it
  // can never be decrypted. Both mark the connection failed so the person
  // reconnects. Any other read failure throws as is: a transient secret-store
  // problem fails this attempt and the sweep retries, the connection stays.
  try {
    const secret = await readAppSecret({
      key: connection.tokenSecretRef,
      scope: "user",
      scopeId: connection.ownerEmail,
    });
    return secret?.value ?? null;
  } catch (err) {
    if (isSecretDecryptionError(err)) {
      throw new SlackTokenError("token_unreadable");
    }
    throw err;
  }
}

/** Live dependencies for slack-huddles-store. */
export function slackHuddleDeps(): HuddleDeps {
  return {
    db: getDb(),
    readToken: readConnectionToken,
    onHuddleParticipants: shareStoppedMeetingWithHuddleParticipants,
  };
}
