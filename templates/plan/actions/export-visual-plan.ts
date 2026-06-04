import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  buildPlanHtml,
  loadPlanBundle,
  planDeepLink,
  planPath,
} from "../server/plans.js";

export default defineAction({
  description:
    "Export an Agent-Native Plan as durable HTML, Markdown fallback, and structured JSON for check-in, handoff, or external-agent review receipts.",
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
    description: "Export a visual plan as HTML, Markdown, and JSON.",
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
