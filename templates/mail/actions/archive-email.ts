import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { summarizeArchiveFailures } from "@shared/archive-errors.js";
import { z } from "zod";

import { archiveEmail } from "../server/lib/email-state.js";

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

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        await archiveEmail({
          id,
          ownerEmail,
          accountEmail: args.accountEmail,
          removeLabel: args.removeLabel,
          threadId: args.threadId,
        });
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err?.message ?? "failed" });
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
