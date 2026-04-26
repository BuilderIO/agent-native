/**
 * List text expansion snippets.
 *
 * Usage:
 *   pnpm action list-snippets
 *   pnpm action list-snippets --search="sig"
 */

import { defineAction } from "@agent-native/core";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "List text expansion snippets. Returns both personal and team snippets visible to the current user.",
  schema: z.object({
    search: z.string().nullish().describe("Search trigger or expansion text"),
    teamOnly: z.boolean().optional().describe("Only show team snippets"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    // Show personal snippets + team snippets the user has access to
    const whereClauses = [];

    if (args.teamOnly) {
      whereClauses.push(eq(schema.dictationSnippets.isTeam, true));
    } else {
      whereClauses.push(
        or(
          eq(schema.dictationSnippets.ownerEmail, ownerEmail),
          eq(schema.dictationSnippets.isTeam, true),
        )!,
      );
    }

    if (args.search) {
      const pat = `%${args.search}%`;
      whereClauses.push(
        sql`(${schema.dictationSnippets.trigger} LIKE ${pat} OR ${schema.dictationSnippets.expansion} LIKE ${pat})`,
      );
    }

    const rows = await db
      .select()
      .from(schema.dictationSnippets)
      .where(and(...whereClauses))
      .orderBy(asc(schema.dictationSnippets.trigger))
      .limit(args.limit)
      .offset(args.offset);

    return { snippets: rows };
  },
});
