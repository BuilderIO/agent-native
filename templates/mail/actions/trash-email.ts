import { defineAction } from "@agent-native/core";
import { getAccessTokens } from "./helpers.js";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { gmailGetMessage, gmailTrashThread } from "../server/lib/google-api.js";
import { isConnected } from "../server/lib/google-auth.js";
import { z } from "zod";

export default defineAction({
  description: "Move one or more emails to trash by ID.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s) to trash, comma-separated"),
  }),
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids || ids.length === 0) return "Error: --id is required";

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      const idSet = new Set(ids);
      let changed = 0;
      const updated = emails.map((email: any) => {
        if (!idSet.has(email.id)) return email;
        changed++;
        return { ...email, isTrashed: true };
      });
      await putUserSetting(ownerEmail, "local-emails", { emails: updated });
      return `Trashed ${changed} email(s) successfully`;
    }

    const accounts = await getAccessTokens();
    if (accounts.length === 0) return "Error: No Google account connected.";

    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of ids) {
      let success = false;
      const errors: string[] = [];
      for (const { accessToken } of accounts) {
        try {
          const msg = await gmailGetMessage(accessToken, id, "minimal");
          await gmailTrashThread(accessToken, msg.threadId);
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

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed > 0) {
      return `Trashed ${succeeded}/${ids.length} email(s). Failures: ${results
        .filter((r) => !r.success)
        .map((r) => `${r.id}: ${r.error}`)
        .join("; ")}`;
    }
    return `Trashed ${succeeded} email(s) successfully`;
  },
});
