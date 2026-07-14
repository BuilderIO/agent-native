import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { trashEmail } from "../server/lib/email-state.js";

// Gmail has no batch endpoint for trash (unlike label add/remove), so bulk
// trash uses bounded-concurrency parallel calls instead of one-at-a-time or
// fully-unbounded fan-out.
const TRASH_CONCURRENCY = 5;

async function trashWithBoundedConcurrency(
  ids: string[],
  run: (id: string, index: number) => Promise<void>,
): Promise<{ id: string; success: boolean; error?: string }[]> {
  const results: { id: string; success: boolean; error?: string }[] = new Array(
    ids.length,
  );
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= ids.length) return;
      const id = ids[i];
      try {
        await run(id, i);
        results[i] = { id, success: true };
      } catch (err: any) {
        results[i] = { id, success: false, error: err?.message ?? "failed" };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TRASH_CONCURRENCY, ids.length) }, worker),
  );
  return results;
}

export default defineAction({
  description: "Move one or more emails to trash by ID.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s) to trash, comma-separated"),
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

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const accountEmailList = args.accountEmails
      ?.split(",")
      .map((s) => s.trim());

    const results = await trashWithBoundedConcurrency(ids, (id, i) =>
      trashEmail({
        id,
        ownerEmail,
        accountEmail: accountEmailList?.[i] || args.accountEmail,
      }).then(() => undefined),
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      throw new Error(
        `Trashed ${succeeded}/${ids.length} email(s). Failures: ${failed.map((r) => `${r.id}: ${r.error}`).join("; ")}`,
      );
    }
    return `Trashed ${succeeded} email(s) successfully`;
  },
});
