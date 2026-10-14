import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Update a dictation row. Patch `fullText`, `cleanedText`, `source`, or `targetApp`. Pass `expectedUpdatedAt` when clearing `cleanedText` to reject a stale undo. Editor access required.",
  schema: z.object({
    id: z.string().describe("Dictation id"),
    fullText: z.string().optional(),
    cleanedText: z.string().nullable().optional(),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Required when clearing cleanedText; update only if the dictation still has this updatedAt value.",
      ),
    source: z
      .enum([
        "fn-hold",
        "cmd-shift-space",
        "manual",
        "mobile",
        "other",
        "fn",
        "custom",
      ])
      .optional(),
    targetApp: z.string().nullable().optional(),
  }),
  run: async (args) => {
    if (args.cleanedText === null && args.expectedUpdatedAt === undefined) {
      throw new Error(
        "expectedUpdatedAt is required when restoring cleaned text",
      );
    }
    if (args.expectedUpdatedAt !== undefined && args.cleanedText !== null) {
      throw new Error(
        "expectedUpdatedAt is only supported when restoring cleaned text",
      );
    }

    await assertAccess("dictation", args.id, "editor");
    const db = getDb();
    const updatedAt = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updatedAt,
    };
    if (args.fullText !== undefined) patch.fullText = args.fullText;
    if (args.cleanedText !== undefined) patch.cleanedText = args.cleanedText;
    if (args.source !== undefined) patch.source = args.source;
    if (args.targetApp !== undefined) patch.targetApp = args.targetApp;

    if (Object.keys(patch).length === 1) {
      throw new Error("update-dictation requires at least one field to change");
    }

    const [updated] = await db
      .update(schema.dictations)
      .set(patch)
      .where(
        args.expectedUpdatedAt === undefined
          ? eq(schema.dictations.id, args.id)
          : and(
              eq(schema.dictations.id, args.id),
              eq(schema.dictations.updatedAt, args.expectedUpdatedAt),
            ),
      )
      .returning({ id: schema.dictations.id });

    if (!updated && args.expectedUpdatedAt !== undefined) {
      return { id: args.id, ok: true, updated: false };
    }
    if (!updated) throw new Error(`Dictation not found: ${args.id}`);

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, ok: true, updated: true };
  },
});
