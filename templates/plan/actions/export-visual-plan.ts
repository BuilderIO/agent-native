import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { buildPlanHtml, loadPlanBundle } from "../server/plans.js";

export default defineAction({
  description:
    "Export an Agent-Native Plan as HTML, Markdown fallback, and structured JSON.",
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
    const markdown =
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
    return {
      html: buildPlanHtml(bundle),
      markdown,
      json: bundle,
    };
  },
});
