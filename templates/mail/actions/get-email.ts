import { defineAction } from "@agent-native/core";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { gmailGetMessage } from "../server/lib/google-api.js";
import { isConnected } from "../server/lib/google-auth.js";
import { gmailToEmailMessage } from "../server/lib/google-auth.js";
import { z } from "zod";

export default defineAction({
  description:
    "Get a single email by ID, including its full body and metadata.",
  schema: z.object({
    id: z.string().optional().describe("Email message ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) return "Error: --id is required";

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      const found = emails.find((e: any) => e.id === args.id);
      return found ? JSON.stringify(found, null, 2) : "Error: Email not found.";
    }

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
