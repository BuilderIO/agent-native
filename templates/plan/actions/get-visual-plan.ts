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
    return {
      ...bundle,
      planId: bundle.plan.id,
      html: isFrontend && isModern ? undefined : buildPlanHtml(bundle),
      mdx: isFrontend
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
