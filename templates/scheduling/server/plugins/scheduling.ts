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
import { getOAuthTokens } from "@agent-native/core/oauth-tokens";
import { getDb, schema } from "../db/index.js";

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
        getAccessToken: async (credentialId) => {
          const t: any = await (getOAuthTokens as any)?.(credentialId);
          const token = t?.accessToken;
          if (!token) throw new Error("Missing Zoom token");
          return token;
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
