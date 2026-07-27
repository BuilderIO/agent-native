import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { toggleStar } from "../server/lib/email-state.js";
import {
  gmailBatchModifyByAccount,
  isConnected,
} from "../server/lib/google-auth.js";
import { invalidateThreadCache } from "../server/lib/thread-cache.js";

export default defineAction({
  description: "Star or unstar one or more emails.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s), comma-separated"),
    unstar: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to remove star"),
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
    threadIds: z
      .string()
      .optional()
      .describe(
        "Per-id thread ID hints, comma-separated and positionally matched to --id (bulk UI calls only)",
      ),
  }),
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids || ids.length === 0) throw new Error("--id is required");
    const isStarred = args.unstar !== true;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const threadIdList = args.threadIds?.split(",").map((s) => s.trim());
    const accountEmailList = args.accountEmails
      ?.split(",")
      .map((s) => s.trim());

    const results: { id: string; success: boolean; error?: string }[] = [];

    if (ids.length > 1 && (await isConnected(ownerEmail))) {
      const targets = ids.map((id, i) => ({
        id,
        threadId: threadIdList?.[i],
        accountEmail: accountEmailList?.[i] || args.accountEmail,
      }));
      const { succeeded, failed } = await gmailBatchModifyByAccount(
        ownerEmail,
        targets,
        isStarred ? ["STARRED"] : undefined,
        isStarred ? undefined : ["STARRED"],
      );
      const threadIdById = new Map(targets.map((t) => [t.id, t.threadId]));
      for (const id of succeeded) {
        const tid = threadIdById.get(id);
        if (tid) invalidateThreadCache(ownerEmail, tid);
        results.push({ id, success: true });
      }
      for (const f of failed)
        results.push({ id: f.id, success: false, error: f.error });
    } else {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
          await toggleStar({
            id,
            ownerEmail,
            isStarred,
            accountEmail: accountEmailList?.[i] || args.accountEmail,
          });
          results.push({ id, success: true });
        } catch (err: any) {
          results.push({ id, success: false, error: err?.message ?? "failed" });
        }
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const action = isStarred ? "Starred" : "Unstarred";
    const succeeded = results.filter((r) => r.success).length;
    return `${action} ${succeeded}/${ids.length} email(s)`;
  },
});
