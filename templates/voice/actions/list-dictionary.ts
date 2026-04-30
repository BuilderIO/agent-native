/**
 * List dictionary terms.
 *
 * Usage:
 *   pnpm action list-dictionary
 *   pnpm action list-dictionary --search="kubernetes"
 */

import { defineAction } from "@agent-native/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "List custom dictionary terms. These are words or phrases the transcription model should recognize or correct.",
  schema: z.object({
    search: z.string().nullish().describe("Search term or correction text"),
    source: z
      .enum(["auto", "manual"])
      .optional()
      .describe("Filter by source (auto-learned or manually added)"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const whereClauses = [
      eq(schema.dictationDictionary.ownerEmail, ownerEmail),
    ];

    if (args.search) {
      const pat = `%${escapeLike(args.search)}%`;
      whereClauses.push(
        sql`(LOWER(${schema.dictationDictionary.term}) LIKE LOWER(${pat}) ESCAPE '\\' OR LOWER(${schema.dictationDictionary.correction}) LIKE LOWER(${pat}) ESCAPE '\\')`,
      );
    }

    if (args.source) {
      whereClauses.push(eq(schema.dictationDictionary.source, args.source));
    }

    const rows = await db
      .select()
      .from(schema.dictationDictionary)
      .where(and(...whereClauses))
      .orderBy(asc(schema.dictationDictionary.term))
      .limit(args.limit)
      .offset(args.offset);

    return { terms: rows };
  },
});
