import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get Visual Plan items that need attention: comments, assumptions, decisions, deviations, and proof gates.",
  schema: z.object({
    contractId: z.string().describe("Visual Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Visual Plan review queue",
    description: "Read plan items that need human or agent attention.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.contractId);
    return {
      plan: bundle.contract,
      contract: bundle.contract,
      reviewQueue: bundle.reviewQueue,
      summary: bundle.summary,
    };
  },
});
