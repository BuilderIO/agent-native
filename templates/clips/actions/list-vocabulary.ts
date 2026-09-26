
import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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
