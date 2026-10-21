import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getAvailableGoogleDocsAccessToken } from "../server/lib/google-docs-access.js";
import { formatGoogleOAuthError } from "../server/lib/google-docs-error.js";
import {
  getGooglePickerConfig,
  isGoogleDocsOAuthConfigured,
} from "../server/lib/google-docs-oauth.js";

export default defineAction({
  title: "Get Google Picker token",
  description:
    "Get the signed-in user's short-lived Google access token and Picker config for the Slides document picker.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: true,
  uiOnly: true,
  agentTool: false,
  run: async () => {
    const owner = getRequestUserEmail();
    if (!owner) {
      fail("not_authenticated", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }

    let configured: boolean;
    try {
      configured = await isGoogleDocsOAuthConfigured(owner);
    } catch (error) {
      fail(formatGoogleOAuthError(error), {
        errorCode: "google_docs_picker_status_failed",
        statusCode: 500,
      });
    }
    if (!configured) {
      fail(
        "Google OAuth credentials are not configured. Save GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in settings.",
        { errorCode: "missing_credentials", statusCode: 422 },
      );
    }

    let picker: Awaited<ReturnType<typeof getGooglePickerConfig>>;
    try {
      picker = await getGooglePickerConfig(owner);
    } catch (error) {
      fail(formatGoogleOAuthError(error), {
        errorCode: "google_docs_picker_config_failed",
        statusCode: 500,
      });
    }
    if (!picker.apiKey || !picker.appId) {
      fail(
        "Google Picker is not configured. Save GOOGLE_PICKER_API_KEY and GOOGLE_PICKER_APP_ID in settings.",
        { errorCode: "missing_picker_config", statusCode: 422 },
      );
    }

    let token: Awaited<ReturnType<typeof getAvailableGoogleDocsAccessToken>>;
    try {
      token = await getAvailableGoogleDocsAccessToken(owner);
    } catch (error) {
      fail(formatGoogleOAuthError(error), {
        errorCode: "google_docs_token_unavailable",
        statusCode: 401,
      });
    }
    if (!token) {
      fail("Connect Google Docs before choosing a document.", {
        errorCode: "not_connected",
        statusCode: 401,
      });
    }

    return {
      ...token,
      apiKey: picker.apiKey,
      appId: picker.appId,
    };
  },
});
