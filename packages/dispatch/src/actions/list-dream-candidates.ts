import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDreamCandidates } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "List recent agent threads worth reviewing in a Dispatch dream pass, scored from grounded signals like corrections, failures, tool errors, feedback, evals, and satisfaction.",
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
      .describe("Optional search term to focus candidate discovery."),
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
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => listDreamCandidates(input),
});
