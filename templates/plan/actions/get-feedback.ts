import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get unconsumed human annotations and feedback for an active visual plan. Agents should call this before editing, after review, and before finalizing.",
  schema: z.object({
    contractId: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Plan feedback",
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
