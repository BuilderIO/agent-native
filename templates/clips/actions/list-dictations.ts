/**
 * List Wispr-style dictations the current user has access to.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List press-and-hold dictations (Wispr tab) sorted newest first. Scoped to the current user via the framework sharing access filter.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.dictations)
      .where(and(accessFilter(schema.dictations, schema.dictationShares)))
      .orderBy(desc(schema.dictations.startedAt))
      .limit(args.limit)
      .offset(args.offset);

    return { dictations: rows };
  },
});
