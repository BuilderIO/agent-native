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
import { randomUUID } from "node:crypto";

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
import { getQuery, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import { getActiveOrganizationId, sameOwnerEmail } from "./recordings.js";
import { SLACK_HUDDLE_USER_SCOPES } from "./slack-huddles.js";
import type { HuddleDeps, SlackUserConnection } from "./slack-huddles-store.js";

export const CLIPS_SLACK_HUDDLES_OAUTH_APP_ID = `${
  process.env.APP_NAME || "clips"
}:slack-huddles`;

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

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

export function slackHuddleTokenKey(teamId: string, slackUserId: string): string {
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
  const state = encodeOAuthState({
    redirectUri,
    owner,
    desktop,
    addAccount: true,
    app: CLIPS_SLACK_HUDDLES_OAUTH_APP_ID,
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
  const slackError = query.error as string | undefined;
  if (slackError) {
    return oauthErrorPage(`Slack connection failed: ${slackError}`);
  }
  if (!state.owner) {
    return oauthErrorPage(
      "Start the Slack connection from Clips Settings so it can be linked to your account.",
    );
  }
  const code = query.code as string | undefined;
  if (!code) return oauthErrorPage("Missing authorization code from Slack.");

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage(
      "Slack OAuth is not configured (missing client id/secret).",
    );
  }

  const session = await getSession(event);
  const userEmail = session?.email ?? state.owner;
  // The flow must finish as the person who started it.
  if (!sameOwnerEmail(userEmail, state.owner)) {
    return oauthErrorPage(
      "You are signed in as someone else than the person who started this Slack connection.",
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

/** Disconnect one of your own huddle connections: revoke and forget the token. */
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

  const secret = await readAppSecret({
    key: row.tokenSecretRef,
    scope: "user",
    scopeId: row.ownerEmail,
  }).catch(() => null);
  if (secret?.value) {
    // Best effort: a token Slack already revoked is fine to forget.
    await (options.fetchImpl ?? fetch)("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret.value}` },
    }).catch(() => {});
  }
  // The connection only counts as disconnected once the token is gone: a
  // failed delete throws, the row stays connected and the user can retry.
  try {
    await deleteAppSecret({
      key: row.tokenSecretRef,
      scope: "user",
      scopeId: row.ownerEmail,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not delete the stored Slack token. Try again. (${reason})`);
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

async function readConnectionToken(
  connection: SlackUserConnection,
): Promise<string | null> {
  // An unreadable secret counts as missing: the connection is then marked
  // failed and the person reconnects.
  const secret = await readAppSecret({
    key: connection.tokenSecretRef,
    scope: "user",
    scopeId: connection.ownerEmail,
  }).catch(() => null);
  return secret?.value ?? null;
}

/** Live dependencies for slack-huddles-store. */
export function slackHuddleDeps(): HuddleDeps {
  return { db: getDb(), readToken: readConnectionToken };
}
