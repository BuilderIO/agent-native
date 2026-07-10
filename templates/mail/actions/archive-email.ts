import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { summarizeArchiveFailures } from "@shared/archive-errors.js";
import { z } from "zod";

import { archiveEmail } from "../server/lib/email-state.js";
import {
  gmailBatchModifyByAccount,
  isConnected,
} from "../server/lib/google-auth.js";
import { invalidateThreadCache } from "../server/lib/thread-cache.js";

function userFacingActionError(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

export default defineAction({
  description:
    "Archive one or more emails by ID. The UI handles navigation to the next email automatically.",
  schema: z.object({
    id: z.string().describe("Email ID(s) to archive, comma-separated"),
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
    removeLabel: z
      .string()
      .optional()
      .describe(
        "Label name/id to also remove when archiving from a label view",
      ),
    threadId: z
      .string()
      .optional()
      .describe("Thread ID hint to skip an extra Gmail API round-trip"),
    threadIds: z
      .string()
      .optional()
      .describe(
        "Per-id thread ID hints, comma-separated and positionally matched to --id (bulk UI calls only)",
      ),
  }),
  run: async (args) => {
    const ids = args.id
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      throw new Error("--id is required");
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const threadIdList = args.threadIds?.split(",").map((s) => s.trim());
    const accountEmailList = args.accountEmails
      ?.split(",")
      .map((s) => s.trim());
    const threadIdFor = (i: number) => threadIdList?.[i] || args.threadId;
    const accountEmailFor = (i: number) =>
      accountEmailList?.[i] || args.accountEmail;

    const results: { id: string; success: boolean; error?: string }[] = [];

    // Bulk path: one Gmail batchModify call per account instead of one
    // modify call per message. Only applies when Gmail is connected and the
    // caller isn't resolving a label-view removeLabel (that needs a
    // per-message label lookup, see archiveEmail's reconciliation notes).
    if (
      ids.length > 1 &&
      !args.removeLabel &&
      (await isConnected(ownerEmail))
    ) {
      const targets = ids.map((id, i) => ({
        id,
        threadId: threadIdFor(i),
        accountEmail: accountEmailFor(i),
      }));
      const { succeeded, failed } = await gmailBatchModifyByAccount(
        ownerEmail,
        targets,
        undefined,
        ["INBOX"],
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
          await archiveEmail({
            id,
            ownerEmail,
            accountEmail: accountEmailFor(i),
            removeLabel: args.removeLabel,
            threadId: threadIdFor(i),
          });
          results.push({ id, success: true });
        } catch (err: any) {
          results.push({ id, success: false, error: err?.message ?? "failed" });
        }
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      const summary = summarizeArchiveFailures({
        succeeded,
        total: ids.length,
        failures: failed.map((r) => r.error ?? "failed"),
      });
      throw userFacingActionError(summary.message, summary.statusCode);
    }
    return `Archived ${succeeded} email(s) successfully`;
  },
});
