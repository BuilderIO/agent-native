import { defineAction } from "@agent-native/core/action";
import { getOwnerJevApiKey } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  findCrmDuplicateCandidates,
  CRM_DUPLICATE_MATCH_REASONS,
} from "../server/lib/dedupe.js";
import { requireCrmScope, queryFlag } from "./_crm-action-utils.js";

const MAX_SEEDS = 25;
const MAX_JEV_PAIRS = 5;

export default defineAction({
  description:
    "Find likely duplicate CRM records and say WHY each pair matched. Checks exact email, company domain, shared email root domain, and normalized name plus location, using indexed sub-field columns. Returns scored candidates with a match reason and confidence per candidate; it never merges anything and never changes a record. Pass recordIds to check specific records, or omit them to check the most recently updated records of an object type. For one explicit recordId, set semanticReview=true to ask Jev for a review-only same-entity probability on up to five ambiguous candidates; this sends their names and match signals to TypeSafe and never merges or replaces deterministic confidence. If Jev is unavailable, semanticReviewUnavailable is true and deterministic candidates remain visible.",
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
    semanticReview: queryFlag.describe(
      "Explicitly send up to five ambiguous candidates for one record to Jev for a review-only second opinion.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    if (args.semanticReview && args.recordIds?.length !== 1) {
      throw new Error("Jev review requires exactly one explicit recordId.");
    }
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

    let semanticReviewUnavailable = false;
    if (args.semanticReview && seeds.length) {
      const seed = seeds[0];
      const candidates = seed.candidates
        .filter((candidate) =>
          candidate.signals.every((signal) => signal.reason !== "email"),
        )
        .slice(0, MAX_JEV_PAIRS);
      if (candidates.length) {
        const owner = requireCrmScope(ctx);
        try {
          const apiKey = await getOwnerJevApiKey(owner.ownerEmail);
          if (!apiKey) throw new Error("Jev is not configured for this user.");

          const response = await fetch("https://api.typesafe.ai/v1/systemone", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "jev-latest",
              state: {
                record: {
                  name: seed.displayName.slice(0, 200),
                  objectType: seed.objectType,
                  kind: seed.kind,
                },
                candidates: candidates.map((candidate) => ({
                  name: candidate.displayName.slice(0, 200),
                  objectType: candidate.objectType,
                  kind: candidate.kind,
                  signals: candidate.signals.map(({ reason, value }) => ({
                    reason,
                    value: value.slice(0, 200),
                  })),
                })),
              },
              questions: Object.fromEntries(
                candidates.map((_, index) => [
                  `candidate_${index}`,
                  {
                    type: "noul",
                    instructions: `Do record and candidates[${index}] describe the same real-world entity? A shared company or email domain alone is weak evidence. Judge only from the provided names and match signals.`,
                    criteria: {
                      true: "The two records likely describe the same entity.",
                      false:
                        "They describe different entities, or the evidence is insufficient to infer a duplicate.",
                    },
                  },
                ]),
              ),
            }),
            signal: AbortSignal.timeout(12_000),
          });
          if (!response.ok) {
            throw new Error(`Jev review failed (${response.status}).`);
          }
          const result = z
            .object({
              answers: z.record(
                z.string(),
                z.object({
                  type: z.literal("noul"),
                  noul: z.number().min(0).max(1),
                }),
              ),
            })
            .parse(await response.json());
          const probabilities = candidates.map((_, index) => {
            const answer = result.answers[`candidate_${index}`];
            if (!answer)
              throw new Error("Jev review returned incomplete answers.");
            return answer.noul;
          });
          candidates.forEach((candidate, index) => {
            candidate.semanticReview = {
              sameEntityProbability: probabilities[index]!,
            };
          });
        } catch (error) {
          semanticReviewUnavailable = true;
          console.warn(
            "[crm] Jev duplicate review unavailable:",
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }
    }

    // Requested ids that produced no seed were not readable by this caller.
    // Reporting them as "no duplicates" would be the same failure this action
    // exists to prevent, so they come back named.
    const found = new Set(seeds.map((seed) => seed.recordId));
    const unreadableRecordIds = recordIds.filter((id) => !found.has(id));

    return {
      checked: seeds.length,
      matchReasons: [...CRM_DUPLICATE_MATCH_REASONS],
      unreadableRecordIds,
      semanticReviewUnavailable,
      records: seeds.filter((seed) => seed.candidates.length > 0),
      cleanRecordIds: seeds
        .filter((seed) => seed.candidates.length === 0)
        .map((seed) => seed.recordId),
    };
  },
});
