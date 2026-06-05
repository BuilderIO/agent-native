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
    const path = planPath(bundle.plan.id);
    const sourceMarkdown =
      bundle.plan.markdown ||
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
      mdx: await exportPlanContentToMdxFolder({
        content: bundle.plan.content,
        title: bundle.plan.title,
        brief: bundle.plan.brief,
        planId: bundle.plan.id,
        url: path,
      }),
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
