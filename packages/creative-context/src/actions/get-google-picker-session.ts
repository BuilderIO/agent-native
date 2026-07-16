import { defineAction } from "@agent-native/core/action";
import { resolveProviderApiOAuthAccessToken } from "@agent-native/core/provider-api";
import { resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

import { getCreativeContext } from "../server/context.js";

export default defineAction({
  description:
    "Return a short-lived Google Picker session for the signed-in Library UI.",
  schema: z.object({
    connectionId: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ connectionId }) => {
    const { connectorContext } = getCreativeContext();
    const [oauth, apiKey, appId] = await Promise.all([
      resolveProviderApiOAuthAccessToken(
        { provider: "google_drive", connectionId },
        {
          appId: connectorContext.appId,
          providerIds: ["google_drive"],
          localCredentialSource: "creative_context_picker",
        },
      ),
      resolveSecret("GOOGLE_PICKER_API_KEY").then(
        (value) => value ?? resolveSecret("GOOGLE_API_KEY"),
      ),
      resolveSecret("GOOGLE_PICKER_APP_ID").then(
        (value) => value ?? resolveSecret("GOOGLE_PROJECT_NUMBER"),
      ),
    ]);
    if (!apiKey || !appId) {
      throw new Error(
        "Google Picker is not configured. Set GOOGLE_PICKER_API_KEY and GOOGLE_PICKER_APP_ID.",
      );
    }
    return {
      accessToken: oauth.accessToken,
      accountLabel: oauth.accountLabel,
      apiKey,
      appId,
    };
  },
});
