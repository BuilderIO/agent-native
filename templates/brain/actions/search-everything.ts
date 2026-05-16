import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { readBrainAgentGuidance } from "../server/lib/brain.js";
import {
  buildFederatedSearchCoverage,
  searchEverythingRows,
} from "../server/lib/search.js";

export default defineAction({
  description:
    "Search Brain-indexed company memory and return deterministic federated coverage/delegation hints for deciding which specialist app to ask next.",
  schema: z.object({
    query: z.string().min(1),
    type: z
      .enum(["all", "knowledge", "capture", "source"])
      .default("all")
      .describe("Restrict results to one normalized result type."),
    provider: z
      .enum(["manual", "generic", "clips", "slack", "granola", "github"])
      .optional()
      .describe("Restrict results to one Brain source provider."),
    status: z.string().optional().describe("Restrict results to one status."),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    isConsequential: false,
  },
  run: async (args) => {
    const { guidance } = await readBrainAgentGuidance();
    const [results, federatedCoverage] = await Promise.all([
      searchEverythingRows(args),
      buildFederatedSearchCoverage(args),
    ]);
    return {
      query: args.query,
      count: results.length,
      policy: guidance.retrieval,
      responseGuidance: guidance.response,
      federatedCoverage,
      results,
    };
  },
});
