import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { setDreamSettings } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Update recurring Dispatch dream settings without immediately running or applying a dream pass.",
  schema: z.object({
    enabled: z
      .boolean()
      .optional()
      .describe("Whether recurring dreams are on."),
    schedule: z
      .string()
      .optional()
      .describe('Five-field cron schedule, for example "0 9 * * 1".'),
    sourceId: z
      .string()
      .optional()
      .describe(
        "Thread debug source id. Use 'all' for every connected source.",
      ),
    sourceIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Optional explicit source ids to scan together."),
    allSources: z.coerce
      .boolean()
      .optional()
      .describe("Scan every connected thread-debug source."),
    query: z
      .string()
      .optional()
      .describe("Optional search term for recurring dream passes."),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    sourceTimeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
    sourceConcurrency: z.coerce.number().int().min(1).max(8).optional(),
    sourceStartStaggerMs: z.coerce.number().int().min(0).max(5000).optional(),
    threadConcurrency: z.coerce.number().int().min(1).max(10).optional(),
    threadTimeoutMs: z.coerce.number().int().min(1000).max(30000).optional(),
    minCandidateCount: z.coerce.number().int().min(0).max(50).optional(),
  }),
  run: async (input) => setDreamSettings(input),
});
