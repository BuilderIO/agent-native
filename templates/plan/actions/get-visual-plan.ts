import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { buildPlanHtml, loadPlanBundle } from "./_plans.js";

export default defineAction({
  description:
    "Get an Agent-Native Plans bundle, including the HTML document, sections, comments, and recent activity.",
  schema: z.object({
    id: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Visual Plan",
    description: "Read the current HTML plan and annotations.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.id);
    return { ...bundle, planId: bundle.plan.id, html: buildPlanHtml(bundle) };
  },
});
