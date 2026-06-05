import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  buildPlanHtml,
  loadPlanBundle,
  planDeepLink,
} from "../server/plans.js";

export default defineAction({
  description:
    "Get an Agent-Native Plans bundle, including structured editable content with stable block IDs, exported HTML, sections, comments, and recent activity. Use this before targeted contentPatches or resolving feedback with update-visual-plan.",
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
    description: "Read the current visual plan content and annotations.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.id);
    return { ...bundle, planId: bundle.plan.id, html: buildPlanHtml(bundle) };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.id),
    label: "Open Plan",
    view: "plan",
  }),
});
