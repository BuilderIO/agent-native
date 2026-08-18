import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  findCrmDuplicateCandidates,
  CRM_DUPLICATE_MATCH_REASONS,
} from "../server/lib/dedupe.js";

const MAX_SEEDS = 25;

export default defineAction({
  description:
    "Find likely duplicate CRM records and say WHY each pair matched. Checks exact email, company domain, shared email root domain, and normalized name plus location, using indexed sub-field columns. Returns scored candidates with a match reason and confidence per candidate; it never merges anything and never changes a record. Pass recordIds to check specific records, or omit them to check the most recently updated records of an object type.",
  schema: z.object({
    recordIds: z
      .array(z.string().trim().min(1).max(128))
      .max(MAX_SEEDS)
      .optional()
      .describe("Records to check. Omit to scan the most recent records."),
    objectType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Restrict an automatic scan to one object type."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_SEEDS)
      .default(10)
      .describe("How many records to check when recordIds is omitted."),
    candidatesPerRecord: z.coerce.number().int().min(1).max(20).default(5),
    minConfidence: z.coerce.number().min(0).max(1).default(0.4),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();

    let recordIds = args.recordIds ?? [];
    if (!recordIds.length) {
      const recent = await db
        .select({ id: schema.crmRecords.id })
        .from(schema.crmRecords)
        .where(
          and(
            eq(schema.crmRecords.tombstone, false),
            ...(args.objectType
              ? [eq(schema.crmRecords.objectType, args.objectType)]
              : []),
            accessFilter(schema.crmRecords, schema.crmRecordShares),
          ),
        )
        .orderBy(desc(schema.crmRecords.updatedAt))
        .limit(args.limit);
      recordIds = recent.map((row) => row.id);
    }

    const seeds = await findCrmDuplicateCandidates({
      db,
      recordIds,
      limit: args.candidatesPerRecord,
      minConfidence: args.minConfidence,
    });

    // Requested ids that produced no seed were not readable by this caller.
    // Reporting them as "no duplicates" would be the same failure this action
    // exists to prevent, so they come back named.
    const found = new Set(seeds.map((seed) => seed.recordId));
    const unreadableRecordIds = recordIds.filter((id) => !found.has(id));

    return {
      checked: seeds.length,
      matchReasons: [...CRM_DUPLICATE_MATCH_REASONS],
      unreadableRecordIds,
      records: seeds.filter((seed) => seed.candidates.length > 0),
      cleanRecordIds: seeds
        .filter((seed) => seed.candidates.length === 0)
        .map((seed) => seed.recordId),
    };
  },
});
