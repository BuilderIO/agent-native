import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get the focused Contracts review queue: assumptions, decisions, deviations, and criteria that need attention.",
  schema: z.object({
    contractId: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Contracts review queue",
    description: "Read the queue of items that need human or agent attention.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.contractId);
    return {
      contract: bundle.contract,
      reviewQueue: bundle.reviewQueue,
      summary: bundle.summary,
    };
  },
});
