import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import { loadPlanBundle, planDeepLink, planPath } from "../server/plans.js";

export default defineAction({
  description:
    "Read an Agent-Native Plan as source-control friendly MDX files. Returns plan.mdx, canvas.mdx when the plan has a board, optional .plan-state.json, and the normalized JSON runtime model.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Read Visual Plan Source",
    description:
      "Read the MDX source files for a visual plan without changing it.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.planId);
    const mdx = await exportPlanContentToMdxFolder({
      content: bundle.plan.content,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      planId: bundle.plan.id,
      url: planPath(bundle.plan.id, bundle.plan.kind),
    });
    return {
      planId: bundle.plan.id,
      mdx,
      content: bundle.plan.content,
      plan: bundle.plan,
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.planId),
    label: "Open Plan",
    view: "plan",
  }),
});
