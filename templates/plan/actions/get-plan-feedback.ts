import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadPlanBundle } from "../server/plans.js";

export default defineAction({
  description:
    "Get unconsumed human comments, corrections, questions, and annotations for an active Agent-Native Plan.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Plan Feedback",
    description:
      "Read plan annotations and feedback the agent has not consumed yet.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.planId);
    return {
      plan: bundle.plan,
      sections: bundle.sections,
      comments: bundle.comments.filter((comment) => !comment.consumedAt),
      summary: bundle.summary,
    };
  },
});
