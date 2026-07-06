import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { markRead } from "../server/lib/email-state.js";
import {
  gmailBatchModifyByAccount,
  isConnected,
} from "../server/lib/google-auth.js";

export default defineAction({
  description: "Mark one or more emails as read or unread.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s), comma-separated"),
    unread: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to mark as unread instead of read"),
    accountEmail: z
      .string()
      .optional()
      .describe("Specific connected account to use"),
    accountEmails: z
      .string()
      .optional()
      .describe(
        "Per-id account emails, comma-separated and positionally matched to --id (bulk UI calls only)",
      ),
  }),
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids || ids.length === 0) throw new Error("--id is required");
    const isRead = args.unread !== true;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const accountEmailList = args.accountEmails
      ?.split(",")
      .map((s) => s.trim());

    const results: { id: string; success: boolean; error?: string }[] = [];

    // Mark-read/unread is message-level (no thread cache invalidation needed,
    // matching markRead's own reconciliation notes), so the batch path here
    // is simpler than archive/star.
    if (ids.length > 1 && (await isConnected(ownerEmail))) {
      const targets = ids.map((id, i) => ({
        id,
        accountEmail: accountEmailList?.[i] || args.accountEmail,
      }));
      const { succeeded, failed } = await gmailBatchModifyByAccount(
        ownerEmail,
        targets,
        isRead ? undefined : ["UNREAD"],
        isRead ? ["UNREAD"] : undefined,
      );
      for (const id of succeeded) results.push({ id, success: true });
      for (const f of failed)
        results.push({ id: f.id, success: false, error: f.error });
    } else {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
          await markRead({
            id,
            ownerEmail,
            isRead,
            accountEmail: accountEmailList?.[i] || args.accountEmail,
          });
          results.push({ id, success: true });
        } catch (err: any) {
          results.push({ id, success: false, error: err?.message ?? "failed" });
        }
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const action = isRead ? "read" : "unread";
    const succeeded = results.filter((r) => r.success).length;
    return `Marked ${succeeded}/${ids.length} email(s) as ${action}`;
  },
});
