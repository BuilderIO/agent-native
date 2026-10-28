import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { untrashEmail } from "../server/lib/email-state.js";

const RESTORE_CONCURRENCY = 5;

export type UntrashEmailActionResult = {
  status: "complete" | "partial";
  requested: string[];
  succeeded: string[];
  failed: { id: string; error: string }[];
  message: string;
};

async function restoreWithBoundedConcurrency(
  ids: string[],
  run: (id: string, index: number) => Promise<void>,
): Promise<{ id: string; success: boolean; error?: string }[]> {
  const results: { id: string; success: boolean; error?: string }[] = new Array(
    ids.length,
  );
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= ids.length) return;
      const id = ids[index];
      try {
        await run(id, index);
        results[index] = { id, success: true };
      } catch (error: unknown) {
        results[index] = {
          id,
          success: false,
          error: error instanceof Error ? error.message : "failed",
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(RESTORE_CONCURRENCY, ids.length) }, worker),
  );
  return results;
}

export default defineAction({
  description:
    "Restore one or more trashed emails to Inbox by ID. For bulk restores, pass accountEmails as comma-separated account addresses in the same order as id. Bulk results include succeeded and failed IDs.",
  schema: z.object({
    id: z
      .string()
      .describe("Email ID(s) to restore from trash, comma-separated"),
    accountEmail: z
      .string()
      .optional()
      .describe("Specific connected account to use"),
    accountEmails: z
      .string()
      .optional()
      .describe(
        "Per-id account emails, comma-separated and positionally matched to id for bulk restores",
      ),
  }),
  run: async (args) => {
    const ids = args.id
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      fail("--id is required", { errorCode: "untrash_ids_required" });
    }

    const accountEmailList = args.accountEmails
      ?.split(",")
      .map((email) => email.trim());
    if (
      accountEmailList &&
      (accountEmailList.length !== ids.length ||
        accountEmailList.some((email) => !email))
    ) {
      fail("accountEmails must contain one account email per id", {
        errorCode: "untrash_account_mapping_invalid",
      });
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("no authenticated user", { errorCode: "unauthenticated" });
    }

    const results = await restoreWithBoundedConcurrency(ids, (id, index) =>
      untrashEmail({
        id,
        ownerEmail,
        accountEmail: accountEmailList?.[index] || args.accountEmail,
      }).then(() => undefined),
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0 && succeeded === 0) {
      fail(
        `Could not restore any of ${ids.length} email(s) to Inbox. Failures: ${failed.map((r) => `${r.id}: ${r.error}`).join("; ")}`,
        { errorCode: "untrash_failed" },
      );
    }
    if (ids.length === 1) {
      return `Restored ${succeeded} email(s) to Inbox successfully`;
    }
    return {
      status: failed.length > 0 ? "partial" : "complete",
      requested: ids,
      succeeded: results.filter((result) => result.success).map((r) => r.id),
      failed: failed.map(({ id, error }) => ({ id, error: error ?? "failed" })),
      message: `Restored ${succeeded} of ${ids.length} email(s) to Inbox${failed.length > 0 ? `; ${failed.length} failed` : ""}.`,
    } satisfies UntrashEmailActionResult;
  },
});
