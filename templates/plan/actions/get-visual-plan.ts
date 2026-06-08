import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import {
  buildPlanHtml,
  loadPlanBundle,
  planDeepLink,
  planPath,
} from "../server/plans.js";

export default defineAction({
  description:
    "Get an Agent-Native Plan bundle, including structured editable content with stable block IDs, source-control friendly MDX, exported HTML, sections, comments, and recent activity. Use this before targeted contentPatches, source patches, or resolving feedback.",
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
    return {
      ...bundle,
      planId: bundle.plan.id,
      html: buildPlanHtml(bundle),
      mdx: await exportPlanContentToMdxFolder({
        content: bundle.plan.content,
        title: bundle.plan.title,
        brief: bundle.plan.brief,
        planId: bundle.plan.id,
        url: planPath(bundle.plan.id),
      }),
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.id),
    label: "Open Plan",
    view: "plan",
  }),
});
