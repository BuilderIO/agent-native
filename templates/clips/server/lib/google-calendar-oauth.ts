import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getQuery, type H3Event } from "h3";
import {
  getSession,
  oauthCallbackResponse,
  oauthErrorPage,
  type OAuthStatePayload,
} from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { writeAppSecret } from "@agent-native/core/secrets";
import { getDb, schema } from "../db/index.js";
import { getActiveOrganizationId } from "./recordings.js";
import { exchangeCode, getUserInfo } from "./google-calendar-client.js";

export const CLIPS_GOOGLE_OAUTH_APP_ID = "clips";

export function isCalendarConnectState(state: OAuthStatePayload): boolean {
  return state.app === CLIPS_GOOGLE_OAUTH_APP_ID && state.addAccount === true;
}

function calendarSecretKey(
  provider: string,
  externalAccountId: string,
  kind: "access" | "refresh",
): string {
  return `clips-calendar:${provider}:${externalAccountId}:${kind}`;
}

export async function handleGoogleCalendarCallback(
  event: H3Event,
  state: OAuthStatePayload,
) {
  const desktop = state.desktop;

  const query = getQuery(event);
  const googleError = query.error as string | undefined;
  if (googleError) {
    const desc = (query.error_description as string | undefined) || googleError;
    return oauthErrorPage(`Google Calendar connection failed: ${desc}`);
  }

  const code = query.code as string | undefined;
  if (!code) {
    return oauthErrorPage("Missing authorization code from Google.");
  }

  const session = await getSession(event);
  const userEmail = session?.email ?? state.owner;
  if (!userEmail) {
    return oauthErrorPage(
      "Your session expired during the OAuth flow. Sign in again and retry.",
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage(
      "Google Calendar OAuth is not configured (missing client id/secret).",
    );
  }

  return runWithRequestContext({ userEmail }, async () => {
    const { redirectUri, returnUrl } = state;

    // 1. Exchange code -> tokens.
    const tokens = await exchangeCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });
    if (!tokens.access_token) {
      return oauthErrorPage("Google did not return an access token.");
    }

    // 2. Fetch profile so we can label the row.
    const profile = await getUserInfo(tokens.access_token);
    const externalAccountId = profile.id;
    const accountEmail = profile.email;

    // 3. Persist tokens in app_secrets (encrypted at rest). NEVER write
    //    tokens onto the calendar_accounts row.
    const accessKey = calendarSecretKey("google", externalAccountId, "access");
    const refreshKey = calendarSecretKey(
      "google",
      externalAccountId,
      "refresh",
    );
    await writeAppSecret({
      key: accessKey,
      value: JSON.stringify({
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : undefined,
        tokenType: tokens.token_type,
        scope: tokens.scope,
      }),
      scope: "user",
      scopeId: userEmail,
      description: `Google Calendar access token for ${accountEmail}`,
    });
    if (tokens.refresh_token) {
      await writeAppSecret({
        key: refreshKey,
        value: tokens.refresh_token,
        scope: "user",
        scopeId: userEmail,
        description: `Google Calendar refresh token for ${accountEmail}`,
      });
    }

    // 4. Upsert the calendar_accounts row.
    const db = getDb();
    const orgId = await getActiveOrganizationId().catch(() => undefined);
    const now = new Date().toISOString();
    const [existing] = await db
      .select({ id: schema.calendarAccounts.id })
      .from(schema.calendarAccounts)
      .where(
        and(
          eq(schema.calendarAccounts.provider, "google"),
          eq(schema.calendarAccounts.externalAccountId, externalAccountId),
          eq(schema.calendarAccounts.ownerEmail, userEmail),
        ),
      );

    if (existing) {
      await db
        .update(schema.calendarAccounts)
        .set({
          accessTokenSecretRef: accessKey,
          // Only overwrite the refresh ref if Google sent us one (it only
          // arrives on the first consent or after re-prompt with prompt=consent).
          ...(tokens.refresh_token
            ? { refreshTokenSecretRef: refreshKey }
            : {}),
          displayName: profile.name ?? accountEmail,
          email: accountEmail,
          status: "connected",
          lastSyncError: null,
          updatedAt: now,
        })
        .where(eq(schema.calendarAccounts.id, existing.id));
    } else {
      await db.insert(schema.calendarAccounts).values({
        id: randomUUID(),
        provider: "google",
        externalAccountId,
        accessTokenSecretRef: accessKey,
        refreshTokenSecretRef: tokens.refresh_token ? refreshKey : null,
        displayName: profile.name ?? accountEmail,
        email: accountEmail,
        status: "connected",
        lastSyncedAt: null,
        lastSyncError: null,
        createdAt: now,
        updatedAt: now,
        ownerEmail: userEmail,
        orgId: orgId ?? null,
        visibility: "private",
      } as any);
    }

    return oauthCallbackResponse(event, accountEmail || userEmail, {
      desktop,
      addAccount: true, // close-tab page; never switch the active session
      returnUrl,
      appName: "Clips",
    });
  });
}
