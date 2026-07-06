import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  exportPlanContentToMdxFolder,
  referencedBlockIdsForPlanComments,
} from "../server/plan-mdx.js";
import {
  buildPlanHtml,
  loadFullPlanEvents,
  loadPlanBundle,
  planDeepLink,
  planPath,
} from "../server/plans.js";

export default defineAction({
  description:
    "Export an Agent-Native Plan as durable HTML, Markdown fallback, structured JSON, and source-control friendly MDX files for check-in, handoff, or external-agent review receipts.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Export Visual Plan",
    description: "Export a visual plan as HTML, Markdown, JSON, and MDX.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.planId);
    // The bundle caps events at the most recent 50 for the hot polled path;
    // an export is a rare, explicit "durable receipt" so it carries the full
    // activity history. loadPlanBundle already resolved access above.
    bundle.events = await loadFullPlanEvents(args.planId);
    const path = planPath(bundle.plan.id, bundle.plan.kind);
    const mdx = await exportPlanContentToMdxFolder({
      content: bundle.plan.content,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      planId: bundle.plan.id,
      url: path,
      referencedBlockIds: referencedBlockIdsForPlanComments(bundle.comments),
    });
    const sourceMarkdown =
      (bundle.plan.content ? mdx["plan.mdx"] : bundle.plan.markdown) ||
      [
        `# ${bundle.plan.title}`,
        "",
        bundle.plan.brief,
        "",
        ...bundle.sections.flatMap((section) => [
          `## ${section.title}`,
          "",
          section.body,
          "",
        ]),
      ].join("\n");
    const markdown = [
      sourceMarkdown.trim(),
      "",
      "---",
      "",
      `Live plan: ${path}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      html: buildPlanHtml(bundle),
      markdown,
      json: bundle,
      mdx,
      path,
      url: path,
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.planId),
    label: "Open Plan",
    view: "plan",
  }),
});
