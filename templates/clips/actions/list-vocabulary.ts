/**
 * List the current user's learned vocabulary terms.
 *
 * Used by the desktop dictation start path: before kicking off
 * `native_speech_start`, the renderer fetches this list and passes the
 * `replacement` strings into `SFSpeechRecognizer.contextualStrings` so the
 * recognizer biases toward the user's preferred spellings.
 *
 * Usage:
 *   pnpm action list-vocabulary
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List the current user's personal-vocabulary entries (auto-learned from post-paste dictation edits).",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.vocabulary)
      .where(and(accessFilter(schema.vocabulary, schema.vocabularyShares)))
      .orderBy(desc(schema.vocabulary.usesCount))
      .limit(args.limit);
    return { vocabulary: rows };
  },
});
