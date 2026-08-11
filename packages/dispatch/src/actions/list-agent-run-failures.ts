import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listAgentRunFailures } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "List recent failed, aborted, or truncated agent runs across the connected thread-debug sources the caller may inspect. Filter interactive and scheduled job runs separately with regime, and use failureTaxonomy to cluster the measured transport, model-configuration, overload, and authentication causes. Use get-agent-thread-debug with a returned source and run ID for the full transcript and event history.",
  schema: z.object({
    sourceId: z
      .string()
      .default("all")
      .describe(
        "Thread debug source id from list-agent-thread-sources, or 'all' to merge every connected source available to the caller.",
      ),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        "Optional owner email filter. Organization admins may only select members of their current organization.",
      ),
    status: z
      .enum(["all", "errored", "aborted", "truncated"])
      .default("all")
      .describe("Unsuccessful run status to include."),
    regime: z
      .enum(["all", "interactive", "scheduled"])
      .default("all")
      .describe(
        "Run population to inspect. Use interactive for ids not starting with job-, scheduled for ids starting with job-, and call both when measuring reliability.",
      ),
    lookbackHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(720)
      .default(168)
      .describe("Lookback window in hours."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Maximum failures returned after merging and sorting sources."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => listAgentRunFailures(input),
});
