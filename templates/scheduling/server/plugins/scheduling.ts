/**
 * Wire up the @agent-native/scheduling runtime at server startup.
 *
 *  - Install the scheduling context (getDb, schema, user/org accessors).
 *  - Register calendar + video providers that have env vars configured.
 *  - Declare required secrets so they appear in the onboarding checklist.
 */
import { setSchedulingContext } from "@agent-native/scheduling/server";
import {
  registerCalendarProvider,
  registerVideoProvider,
  createGoogleCalendarProvider,
  createOffice365Provider,
  createZoomProvider,
  googleMeetProvider,
} from "@agent-native/scheduling/server/providers";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { registerRequiredSecret } from "@agent-native/core/secrets";
import {
  getOAuthTokens,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

export default () => {
  setSchedulingContext({
    getDb,
    schema,
    getCurrentUserEmail: () => getRequestUserEmail() ?? undefined,
    getCurrentOrgId: () => getRequestOrgId() ?? undefined,
    publicBaseUrl: process.env.PUBLIC_URL,
  });

  // Register providers that have env vars. Missing env → provider skipped;
  // UI shows "not configured" instead of a broken connect button.
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    registerCalendarProvider(
      createGoogleCalendarProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        getAccessToken: async (credentialId) => {
          const t: any = await (getOAuthTokens as any)?.(credentialId);
          const token = t?.accessToken;
          if (!token) throw new Error("Missing Google token");
          return token;
        },
      }),
    );
    registerVideoProvider(googleMeetProvider);
  }

  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    registerCalendarProvider(
      createOffice365Provider({
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        getAccessToken: async (credentialId) => {
          const t: any = await (getOAuthTokens as any)?.(credentialId);
          const token = t?.accessToken;
          if (!token) throw new Error("Missing MS token");
          return token;
        },
      }),
    );
  }

  if (process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET) {
    registerVideoProvider(
      createZoomProvider({
        clientId: process.env.ZOOM_CLIENT_ID,
        clientSecret: process.env.ZOOM_CLIENT_SECRET,
        getAccessToken: (credentialId) => getZoomAccessToken(credentialId),
        updateTokens: async (credentialId, tokens) => {
          await saveOAuthTokens("zoom_video", credentialId, {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt?.getTime(),
          });
        },
        markInvalid: async (credentialId) => {
          await getDb()
            .update(schema.schedulingCredentials)
            .set({ invalid: true, updatedAt: new Date().toISOString() })
            .where(eq(schema.schedulingCredentials.id, credentialId));
        },
      }),
    );
  }

  // Declare required secrets so the onboarding checklist lists them.
  registerRequiredSecret({
    key: "GOOGLE_CLIENT_ID",
    label: "Google OAuth Client ID",
    scope: "workspace",
    kind: "api-key",
  });
  registerRequiredSecret({
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    scope: "workspace",
    kind: "api-key",
  });
  registerRequiredSecret({
    key: "ZOOM_CLIENT_ID",
    label: "Zoom OAuth Client ID",
    scope: "workspace",
    kind: "api-key",
  });
  registerRequiredSecret({
    key: "ZOOM_CLIENT_SECRET",
    label: "Zoom OAuth Client Secret",
    scope: "workspace",
    kind: "api-key",
  });
};

/**
 * Resolve a Zoom access token for a given credentialId, refreshing against
 * the Zoom token endpoint if it's expired or near-expiry.
 */
async function getZoomAccessToken(credentialId: string): Promise<string> {
  const record: any = await (getOAuthTokens as any)("zoom_video", credentialId);
  if (!record?.accessToken) {
    throw new Error("Zoom credential missing access token");
  }
  const expiresAt: number | undefined = record.expiresAt;
  const stillFresh =
    typeof expiresAt === "number" && expiresAt > Date.now() + 60_000;
  if (stillFresh) return record.accessToken;

  if (!record.refreshToken) return record.accessToken;

  const clientId = process.env.ZOOM_CLIENT_ID!;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refreshToken,
  });
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    // If refresh fails, mark credential invalid and fall back to last token.
    await getDb()
      .update(schema.schedulingCredentials)
      .set({ invalid: true, updatedAt: new Date().toISOString() })
      .where(eq(schema.schedulingCredentials.id, credentialId));
    return record.accessToken;
  }
  const next = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  await saveOAuthTokens("zoom_video", credentialId, {
    accessToken: next.access_token,
    refreshToken: next.refresh_token ?? record.refreshToken,
    expiresAt: Date.now() + (next.expires_in ?? 3600) * 1000,
  });
  return next.access_token;
}
