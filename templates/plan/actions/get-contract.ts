import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get a visual plan bundle including plan items, annotations, feedback, proof gates, evidence, and review queue.",
  schema: z.object({
    id: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Plan",
    description: "Read a visual plan bundle.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.id);
    return { ...bundle, plan: bundle.contract, planId: bundle.contract.id };
  },
});
