import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { buildPlanHtml, loadPlanBundle } from "../server/plans.js";

export default defineAction({
  description:
    "Get an Agent-Native Plans bundle, including the current rendered HTML document, sections, comments, and recent activity. Use this before patching a visual plan with update-visual-plan.",
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
    description: "Read the current live HTML plan and annotations.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.id);
    return { ...bundle, planId: bundle.plan.id, html: buildPlanHtml(bundle) };
  },
});
