import { defineAction, embedApp } from "@agent-native/core";
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
    "Get an Agent-Native Plan bundle, including structured editable content with stable block IDs, source-control friendly MDX, exported HTML, sections, comments, and recent activity. Call this before targeted contentPatches, source patches, or resolving feedback on a specific plan.",
  schema: z.object({
    id: z.string().describe("Plan ID"),
    include: z
      .object({
        mdx: z
          .boolean()
          .optional()
          .describe(
            "Include the exported MDX folder in the response. Defaults to true for agents; set false to skip the Prettier-formatted MDX export when you only need structured content or HTML.",
          ),
        html: z
          .boolean()
          .optional()
          .describe(
            "Include the exported HTML bundle in the response. Defaults to true for legacy plans; set false to skip when you only need structured content.",
          ),
      })
      .optional()
      .describe(
        "Control which expensive fields are included in the response. Defaults match the existing behaviour so nothing breaks.",
      ),
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
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan",
      description:
        "Open the Agent-Native Plan review surface for structured blocks, annotations, and comments.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Plan",
      height: 860,
    }),
  },
  run: async (args, ctx) => {
    const bundle = await loadPlanBundle(args.id);
    // The interactive web viewer renders modern (structured-`content`) plans
    // with the React `PlanContentRenderer` and never reads the server-built
    // `html` or `mdx`: `html` only feeds the legacy iframe path (plans with no
    // `content`), and `mdx` is the source-control export served on demand by
    // `export-visual-plan`. Both were rebuilt on every read, and `usePlan`
    // polls this action every 3s, so for the common case — a modern plan open
    // in a browser — that was pure throwaway work holding the loading skeleton
    // up, `mdx` worst of all (it Prettier-formats up to three MDX files). So
    // skip what the frontend won't use. Agents / HTTP / CLI keep the full
    // advertised contract, and legacy (content-less) plans still get `html`
    // for their iframe.
    const isFrontend = ctx?.caller === "frontend";
    const isModern = Boolean(bundle.plan.content);
    // Caller-controlled opt-out; defaults preserve existing behavior.
    const wantMdx = args.include?.mdx ?? true;
    const wantHtml = args.include?.html ?? true;
    return {
      ...bundle,
      planId: bundle.plan.id,
      html:
        !wantHtml || (isFrontend && isModern)
          ? undefined
          : buildPlanHtml(bundle),
      mdx:
        !wantMdx || isFrontend
          ? undefined
          : await exportPlanContentToMdxFolder({
              content: bundle.plan.content,
              title: bundle.plan.title,
              brief: bundle.plan.brief,
              planId: bundle.plan.id,
              url: planPath(bundle.plan.id, bundle.plan.kind),
            }),
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.id),
    label: "Open Plan",
    view: "plan",
  }),
});
