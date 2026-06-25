import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { ensureDreamJob } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Create or update the personal recurring Dispatch dream job resource at jobs/dispatch-dream.md.",
  schema: z.object({
    schedule: z
      .string()
      .optional()
      .describe(
        'Optional five-field cron schedule. Defaults to weekly: "0 9 * * 1".',
      ),
    sourceId: z
      .string()
      .default("all")
      .describe("Thread debug source id for the recurring dream pass."),
    sourceIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Optional explicit source ids for recurring dream passes."),
    allSources: z.coerce
      .boolean()
      .default(true)
      .describe("Scan every connected source for recurring dream passes."),
    query: z
      .string()
      .optional()
      .describe("Optional search term to focus recurring dream passes."),
    limit: z.coerce.number().int().min(1).max(50).default(8),
    sourceTimeoutMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(30000)
      .describe("Per-source timeout in milliseconds."),
    sourceConcurrency: z.coerce
      .number()
      .int()
      .min(1)
      .max(8)
      .default(2)
      .describe("How many sources to scan at once."),
    sourceStartStaggerMs: z.coerce
      .number()
      .int()
      .min(0)
      .max(5000)
      .default(250)
      .describe("Delay between source starts within each scan batch."),
    threadConcurrency: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("How many threads to inspect at once within each source."),
    threadTimeoutMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(30000)
      .default(8000)
      .describe("Per-thread debug timeout in milliseconds."),
    minCandidateCount: z.coerce
      .number()
      .int()
      .min(0)
      .max(50)
      .default(1)
      .describe("Skip recurring report creation below this candidate count."),
  }),
  run: async (input) => ensureDreamJob(input),
});
