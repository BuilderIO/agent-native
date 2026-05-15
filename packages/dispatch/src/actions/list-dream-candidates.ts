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
      .describe("Thread debug source id from list-agent-thread-sources."),
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
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => listDreamCandidates(input),
});
