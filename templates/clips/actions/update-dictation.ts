import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const INVALID_INPUT = {
  errorCode: "dictation_invalid_input",
  statusCode: 400,
} as const;

const DICTATION_NOT_FOUND = {
  errorCode: "dictation_not_found",
  statusCode: 404,
} as const;

export default defineAction({
  description:
    "Update a dictation row. Patch `fullText`, `cleanedText`, `source`, or `targetApp`. Pass `expectedCleanupVersion` when clearing `cleanedText`; the action returns a conflict if that version is stale and fails if the dictation no longer exists. Editor access required.",
  schema: z.object({
    id: z.string().describe("Dictation id"),
    fullText: z.string().optional(),
    cleanedText: z.string().nullable().optional(),
    expectedCleanupVersion: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Required when clearing cleanedText; update only if the dictation still has this cleanup version.",
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
    if (
      args.cleanedText === null &&
      args.expectedCleanupVersion === undefined
    ) {
      fail(
        "expectedCleanupVersion is required when restoring cleaned text",
        INVALID_INPUT,
      );
    }
    if (
      args.expectedCleanupVersion !== undefined &&
      args.cleanedText !== null
    ) {
      fail(
        "expectedCleanupVersion is only supported when restoring cleaned text",
        INVALID_INPUT,
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
    if (args.cleanedText !== undefined || args.fullText !== undefined) {
      patch.cleanupVersion = sql`${schema.dictations.cleanupVersion} + 1`;
    }
    if (args.source !== undefined) patch.source = args.source;
    if (args.targetApp !== undefined) patch.targetApp = args.targetApp;

    if (Object.keys(patch).length === 1) {
      fail(
        "update-dictation requires at least one field to change",
        INVALID_INPUT,
      );
    }

    const [updated] = await db
      .update(schema.dictations)
      .set(patch)
      .where(
        args.expectedCleanupVersion === undefined
          ? eq(schema.dictations.id, args.id)
          : and(
              eq(schema.dictations.id, args.id),
              eq(schema.dictations.cleanupVersion, args.expectedCleanupVersion),
            ),
      )
      .returning({ id: schema.dictations.id });

    if (!updated && args.expectedCleanupVersion !== undefined) {
      const [current] = await db
        .select({ id: schema.dictations.id })
        .from(schema.dictations)
        .where(eq(schema.dictations.id, args.id))
        .limit(1);
      if (!current)
        fail(`Dictation not found: ${args.id}`, DICTATION_NOT_FOUND);
      return { id: args.id, conflict: true };
    }
    if (!updated) fail(`Dictation not found: ${args.id}`, DICTATION_NOT_FOUND);

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, conflict: false, ok: true, updated: true };
  },
});
