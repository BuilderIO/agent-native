import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get unconsumed human annotations and feedback for an active Visual Plan. Agents should call this before editing, after review, and before finalizing.",
  schema: z.object({
    contractId: z.string().describe("Visual Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Visual Plan feedback",
    description:
      "Read unconsumed plan annotations and structured feedback for the agent.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.contractId);
    return {
      plan: bundle.contract,
      contract: bundle.contract,
      feedback: bundle.feedback.filter((item) => !item.consumedAt),
      reviewQueue: bundle.reviewQueue,
      summary: bundle.summary,
    };
  },
});
