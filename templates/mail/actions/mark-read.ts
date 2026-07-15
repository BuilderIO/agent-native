import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { markAllLocalUnreadRead, markRead } from "../server/lib/email-state.js";
import {
  gmailBatchModifyByAccount,
  isConnected,
  markAllUnreadReadForAccount,
} from "../server/lib/google-auth.js";

export const MARK_READ_DESCRIPTION =
  'Mark explicit email IDs as read/unread, or use scope "all-unread" once to mark every unread message in one account read while preserving excluded thread IDs. Never loop mark-thread-read for broad cleanup.';

export default defineAction({
  description: MARK_READ_DESCRIPTION,
  schema: z
    .object({
      id: z.string().optional().describe("Email ID(s), comma-separated"),
      unread: z.coerce
        .boolean()
        .optional()
        .describe("Set to true to mark explicit IDs unread instead of read"),
      accountEmail: z
        .string()
        .optional()
        .describe(
          'Exact connected account; required when scope is "all-unread"',
        ),
      accountEmails: z
        .string()
        .optional()
        .describe(
          "Per-id account emails, comma-separated and positionally matched to --id (bulk UI calls only)",
        ),
      scope: z
        .enum(["all-unread"])
        .optional()
        .describe(
          'Mark every unread message in accountEmail read in one verified action; mutually exclusive with "id"',
        ),
      excludeThreadIds: z
        .string()
        .optional()
        .describe(
          'Thread IDs to leave unread, comma-separated; valid only with scope "all-unread"',
        ),
    })
    .superRefine((args, ctx) => {
      const hasIds = Boolean(args.id?.trim());
      const hasScope = Boolean(args.scope);
      if (hasIds === hasScope) {
        ctx.addIssue({
          code: "custom",
          message: 'Provide exactly one of "id" or "scope"',
        });
      }
      if (hasScope && !args.accountEmail?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["accountEmail"],
          message: 'accountEmail is required for scope "all-unread"',
        });
      }
      if (hasScope && args.accountEmails) {
        ctx.addIssue({
          code: "custom",
          path: ["accountEmails"],
          message: 'accountEmails cannot be used with scope "all-unread"',
        });
      }
      if (hasScope && args.unread === true) {
        ctx.addIssue({
          code: "custom",
          path: ["unread"],
          message: 'scope "all-unread" can only mark messages read',
        });
      }
      if (hasIds && args.excludeThreadIds) {
        ctx.addIssue({
          code: "custom",
          path: ["excludeThreadIds"],
          message: "excludeThreadIds can only be used with bulk scope",
        });
      }
    }),
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const hasIds = Boolean(ids?.length);
    const hasScope = args.scope === "all-unread";
    if (hasIds === hasScope) {
      throw new Error('Provide exactly one of "id" or "scope"');
    }

    if (hasScope) {
      if (!args.accountEmail?.trim()) {
        throw new Error('accountEmail is required for scope "all-unread"');
      }
      if (args.accountEmails) {
        throw new Error('accountEmails cannot be used with scope "all-unread"');
      }
      if (args.unread === true) {
        throw new Error('scope "all-unread" can only mark messages read');
      }

      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");
      const excludeThreadIds = (args.excludeThreadIds ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const input = {
        ownerEmail,
        accountEmail: args.accountEmail.trim(),
        excludeThreadIds,
      };
      const result = (await isConnected(ownerEmail))
        ? await markAllUnreadReadForAccount(input)
        : await markAllLocalUnreadRead(input);

      await writeAppState("refresh-signal", { ts: Date.now() });

      if (!result.verificationComplete) {
        const error = new Error(
          `Bulk mark-read incomplete for ${result.accountEmail}: matched ${result.matchedMessages}, excluded ${result.excludedMessages}, changed ${result.changedMessages}; ${result.failures.length} failed and ${result.unexpectedUnreadMessages} unexpected unread messages remain`,
        ) as Error & { details?: typeof result };
        error.details = result;
        throw error;
      }
      return result;
    }

    if (!ids || ids.length === 0) {
      throw new Error('Provide exactly one of "id" or "scope"');
    }
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
