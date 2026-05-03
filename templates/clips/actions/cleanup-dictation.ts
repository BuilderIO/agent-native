/**
 * Run the Gemini cleanup pass on a dictation's raw transcript text.
 * Persists `cleanedText` on the dictation row.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import cleanupTranscript from "./cleanup-transcript.js";

export default defineAction({
  description:
    "Clean up a dictation's raw text via the Gemini 3.1 Flash-Lite cleanup pass. Stores the result on `dictations.cleanedText`. Editor access required.",
  schema: z.object({
    id: z.string().describe("Dictation id"),
  }),
  run: async (args) => {
    await assertAccess("dictation", args.id, "editor");
    const db = getDb();
    const [dictation] = await db
      .select()
      .from(schema.dictations)
      .where(eq(schema.dictations.id, args.id))
      .limit(1);
    if (!dictation) throw new Error(`Dictation not found: ${args.id}`);

    const raw = dictation.fullText?.trim() ?? "";
    if (!raw) {
      throw new Error("Dictation has no transcript to clean up");
    }

    const result = await cleanupTranscript.run({
      transcript: raw,
      task: "cleanup",
    });
    const cleanedText = result.cleanedText ?? raw;

    await db
      .update(schema.dictations)
      .set({
        cleanedText,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.dictations.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, cleanedText, provider: result.provider };
  },
});
