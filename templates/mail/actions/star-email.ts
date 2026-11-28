import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  resolveMutationAccounts,
  toggleStar,
  unstarThread,
} from "../server/lib/email-state.js";
import { GmailQuotaCooldownError } from "../server/lib/google-api.js";
import {
  gmailBatchModifyByAccount,
  isConnected,
} from "../server/lib/google-auth.js";
import { syncInboxLabelDeltaForTargets } from "../server/lib/inbox-store-sync.js";
import { invalidateThreadCache } from "../server/lib/thread-cache.js";

export default defineAction({
  description:
    "Star or unstar one or more emails, or unstar a whole conversation with threadId.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s), comma-separated"),
    threadId: z
      .string()
      .optional()
      .describe(
        "With unstar, remove the star from every message of this conversation instead of --id",
      ),
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
  mcpTool: "search",
  run: async (args) => {
    const ids =
      args.id
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const isStarred = args.unstar !== true;
    if (args.threadId ? ids.length > 0 || isStarred : ids.length === 0) {
      fail(
        args.threadId
          ? "--threadId unstars a whole conversation: pass --unstar, not --id."
          : "--id is required",
        { errorCode: "invalid_star_target" },
      );
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (args.threadId) {
      await unstarThread({
        threadId: args.threadId,
        ownerEmail,
        accountEmail: args.accountEmail,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      return `Unstarred thread ${args.threadId}`;
    }

    const threadIdList = args.threadIds?.split(",").map((s) => s.trim());
    const accountEmailList = args.accountEmails
      ?.split(",")
      .map((s) => s.trim());

    const results: { id: string; success: boolean; error?: string }[] = [];
    let batchMutationResult:
      | {
          requested: string[];
          succeeded: string[];
          failed: Array<{ id: string; error: string }>;
          remaining: string[];
          retryAfterSeconds?: number;
        }
      | undefined;

    if (ids.length > 1 && (await isConnected(ownerEmail))) {
      const targets = ids.map((id, i) => ({
        id,
        threadId: threadIdList?.[i],
        accountEmail: accountEmailList?.[i] || args.accountEmail,
      }));
      const { resolved, unresolved } = await resolveMutationAccounts(
        ownerEmail,
        targets,
      );
      const { succeeded, failed, remaining, retryAfterSeconds } =
        await gmailBatchModifyByAccount(
          ownerEmail,
          resolved,
          isStarred ? ["STARRED"] : undefined,
          isStarred ? undefined : ["STARRED"],
        );
      const threadIdById = new Map(resolved.map((t) => [t.id, t.threadId]));
      for (const id of succeeded) {
        const tid = threadIdById.get(id);
        if (tid) invalidateThreadCache(ownerEmail, tid);
      }
      await syncInboxLabelDeltaForTargets(
        ownerEmail,
        resolved.filter((t) => succeeded.includes(t.id)),
        {
          add: isStarred ? ["STARRED"] : undefined,
          remove: isStarred ? undefined : ["STARRED"],
          scope: "message",
        },
      );
      batchMutationResult = {
        requested: ids,
        succeeded,
        failed: [
          ...failed,
          ...unresolved.map(({ id, error }) => ({ id, error })),
        ],
        remaining,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      };
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
          if (err instanceof GmailQuotaCooldownError) {
            batchMutationResult = {
              requested: ids,
              succeeded: results
                .filter((result) => result.success)
                .map((result) => result.id),
              failed: results
                .filter((result) => !result.success)
                .map(({ id, error }) => ({ id, error: error ?? "failed" })),
              remaining: ids.slice(i),
              retryAfterSeconds: err.details.retryAfterSeconds,
            };
            break;
          }
          results.push({ id, success: false, error: err?.message ?? "failed" });
        }
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    if (batchMutationResult) return batchMutationResult;

    const action = isStarred ? "Starred" : "Unstarred";
    const succeeded = results.filter((r) => r.success).length;
    return `${action} ${succeeded}/${ids.length} email(s)`;
  },
});
