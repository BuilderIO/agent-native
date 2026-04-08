import { defineAction } from "@agent-native/core";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";
import { gmailGetMessage } from "../server/lib/google-api.js";
import { gmailToEmailMessage } from "../server/lib/google-auth.js";

export default defineAction({
  description:
    "Get a single email by ID, including its full body and metadata.",
  parameters: {
    id: { type: "string", description: "Email message ID" },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) return "Error: --id is required";

    const accounts = await getAccessTokens();
    if (accounts.length === 0) return "Error: No Google account connected.";

    for (const { email, accessToken } of accounts) {
      try {
        const labelMap = await fetchLabelMap(accessToken);
        const msg = await gmailGetMessage(accessToken, args.id, "full");
        const parsed = gmailToEmailMessage(msg, email, labelMap);
        return JSON.stringify(parsed, null, 2);
      } catch (err: any) {
        if (err?.message?.includes("404")) continue;
        return `Error: ${err?.message}`;
      }
    }
    return "Error: Email not found in any connected account.";
  },
});
