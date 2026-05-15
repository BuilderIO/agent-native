import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createDreamReport } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Create a Dispatch dream report from existing thread-debug records and produce pending, evidence-backed memory proposals without calling an LLM.",
  schema: z.object({
    sourceId: z
      .string()
      .default("current")
      .describe(
        "Thread debug source id from list-agent-thread-sources. Use 'all' to scan every connected source.",
      ),
    sourceIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Optional explicit source ids to scan together. When provided, sourceId is treated as aggregate.",
      ),
    allSources: z.coerce
      .boolean()
      .default(false)
      .describe(
        "Scan every connected thread-debug source with partial results.",
      ),
    query: z
      .string()
      .optional()
      .describe("Optional search term to focus dream candidate discovery."),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        "Optional owner email filter. Admins may pass '*' or omit to use their admin-visible scope.",
      ),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    sourceTimeoutMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000)
      .describe("Per-source timeout in milliseconds for partial scans."),
    title: z.string().optional().describe("Optional title for the dream pass."),
  }),
  run: async (input) => createDreamReport(input),
});
