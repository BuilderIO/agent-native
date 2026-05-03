/**
 * Update a dictation's text or metadata. Used by the Dictate tab UI to
 * promote `cleanedText` into `fullText` ("Replace original with cleaned"),
 * inline-edit raw text, or change the source label after the fact.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Update a dictation row. Patch `fullText`, `cleanedText`, `source`, or `targetApp`. Editor access required.",
  schema: z.object({
    id: z.string().describe("Dictation id"),
    fullText: z.string().optional(),
    cleanedText: z.string().nullable().optional(),
    source: z
      .enum(["fn-hold", "cmd-shift-space", "manual", "other"])
      .optional(),
    targetApp: z.string().nullable().optional(),
  }),
  run: async (args) => {
    await assertAccess("dictation", args.id, "editor");
    const db = getDb();
    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (args.fullText !== undefined) patch.fullText = args.fullText;
    if (args.cleanedText !== undefined) patch.cleanedText = args.cleanedText;
    if (args.source !== undefined) patch.source = args.source;
    if (args.targetApp !== undefined) patch.targetApp = args.targetApp;

    if (Object.keys(patch).length === 1) {
      throw new Error("update-dictation requires at least one field to change");
    }

    await db
      .update(schema.dictations)
      .set(patch)
      .where(eq(schema.dictations.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, ok: true };
  },
});
