import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { unarchiveEmail } from "../server/lib/email-state.js";

export default defineAction({
  description: "Restore one or more archived emails back to the inbox.",
  schema: z.object({
    id: z.string().describe("Email ID(s) to unarchive, comma-separated"),
    accountEmail: z
      .string()
      .optional()
      .describe("Specific connected account to use"),
  }),
  run: async (args) => {
    const ids = args.id
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) throw new Error("--id is required");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        await unarchiveEmail({
          id,
          ownerEmail,
          accountEmail: args.accountEmail,
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
      throw new Error(
        `Unarchived ${succeeded}/${ids.length} email(s). Failures: ${failed.map((r) => `${r.id}: ${r.error}`).join("; ")}`,
      );
    }
    return `Unarchived ${succeeded} email(s) successfully`;
  },
});
