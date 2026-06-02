import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get unconsumed human feedback for an active Contracts review. Agents should call this before risky edits and before finalizing.",
  schema: z.object({
    contractId: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Contracts feedback",
    description: "Read unconsumed structured feedback for the agent.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.contractId);
    return {
      contract: bundle.contract,
      feedback: bundle.feedback.filter((item) => !item.consumedAt),
      reviewQueue: bundle.reviewQueue,
      summary: bundle.summary,
    };
  },
});
