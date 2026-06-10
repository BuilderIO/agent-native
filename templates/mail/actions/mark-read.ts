import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";
import { markRead } from "../server/lib/email-state.js";
import { z } from "zod";

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

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        await markRead({
          id,
          ownerEmail,
          isRead,
          accountEmail: args.accountEmail,
        });
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err?.message ?? "failed" });
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const action = isRead ? "read" : "unread";
    const succeeded = results.filter((r) => r.success).length;
    return `Marked ${succeeded}/${ids.length} email(s) as ${action}`;
  },
});
