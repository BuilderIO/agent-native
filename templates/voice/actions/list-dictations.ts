/**
 * List dictations with optional search/filter.
 *
 * Usage:
 *   pnpm action list-dictations
 *   pnpm action list-dictations --search="meeting notes"
 *   pnpm action list-dictations --language=en --sort=oldest
 */

import { defineAction } from "@agent-native/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "List dictations for the current user. Supports search by text content, filtering by language, and sort order.",
  schema: z.object({
    search: z
      .string()
      .nullish()
      .describe("Search text content (substring match)"),
    language: z
      .string()
      .nullish()
      .describe("Filter by language code (e.g. 'en', 'es')"),
    sort: z
      .enum(["recent", "oldest", "longest"])
      .default("recent")
      .describe("Sort order"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const whereClauses = [eq(schema.dictations.ownerEmail, ownerEmail)];

    if (args.search) {
      const pat = `%${escapeLike(args.search)}%`;
      whereClauses.push(
        sql`(LOWER(${schema.dictations.text}) LIKE LOWER(${pat}) ESCAPE '\\' OR LOWER(${schema.dictations.rawText}) LIKE LOWER(${pat}) ESCAPE '\\')`,
      );
    }

    if (args.language) {
      whereClauses.push(eq(schema.dictations.language, args.language));
    }

    const orderBy =
      args.sort === "oldest"
        ? asc(schema.dictations.createdAt)
        : args.sort === "longest"
          ? desc(schema.dictations.durationMs)
          : desc(schema.dictations.createdAt);

    const rows = await db
      .select()
      .from(schema.dictations)
      .where(and(...whereClauses))
      .orderBy(orderBy)
      .limit(args.limit)
      .offset(args.offset);

    return { dictations: rows };
  },
});
