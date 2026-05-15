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
      .default("current")
      .describe("Thread debug source id for the recurring dream pass."),
    query: z
      .string()
      .optional()
      .describe("Optional search term to focus recurring dream passes."),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  run: async (input) => ensureDreamJob(input),
});
