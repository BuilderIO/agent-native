import { defineAction } from "@agent-native/core";
import { getAccessTokens } from "./helpers.js";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { gmailModifyMessage } from "../server/lib/google-api.js";
import { isConnected } from "../server/lib/google-auth.js";
import { z } from "zod";

export default defineAction({
  description: "Star or unstar one or more emails.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s), comma-separated"),
    unstar: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to remove star"),
  }),
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids || ids.length === 0) return "Error: --id is required";
    const unstar = args.unstar === true;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails)
          ? (data as any).emails
          : [];
      const idSet = new Set(ids);
      let changed = 0;
      const updated = emails.map((email: any) => {
        if (!idSet.has(email.id)) return email;
        changed++;
        return { ...email, isStarred: !unstar };
      });
      await putUserSetting(ownerEmail, "local-emails", { emails: updated });
      const action = unstar ? "Unstarred" : "Starred";
      return `${action} ${changed}/${ids.length} email(s)`;
    }

    const accounts = await getAccessTokens();
    if (accounts.length === 0) return "Error: No Google account connected.";

    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of ids) {
      let success = false;
      const errors: string[] = [];
      for (const { accessToken } of accounts) {
        try {
          await gmailModifyMessage(
            accessToken,
            id,
            unstar ? undefined : ["STARRED"],
            unstar ? ["STARRED"] : undefined,
          );
          success = true;
          break;
        } catch (err: any) {
          errors.push(err?.message || "Gmail API error");
        }
      }
      results.push(
        success
          ? { id, success: true }
          : { id, success: false, error: errors.join("; ") },
      );
    }

    const action = unstar ? "Unstarred" : "Starred";
    const succeeded = results.filter((r) => r.success).length;
    return `${action} ${succeeded}/${ids.length} email(s)`;
  },
});
