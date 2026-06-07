import { defineAction, embedApp } from "@agent-native/core";
import { z } from "zod";
import importVisualPlanSourceAction from "./import-visual-plan-source.js";
import { planMdxFileSchema } from "../server/plan-mdx.js";
import {
  planDeepLink,
  planSourceSchema,
  planStatusSchema,
} from "../server/plans.js";

export default defineAction({
  description:
    "Create or replace a visual recap plan from source-control friendly MDX generated from a PR, commit, branch, or git diff. Use this for high-altitude code review recaps after a code change exists; the caller should derive the MDX from the real diff and avoid inventing schema, API, file, or contract facts. When the diff changes rendered UI, include realistic wireframes of the changed surface instead of abstract diagrams.",
  schema: z.object({
    planId: z
      .string()
      .optional()
      .describe("Existing recap plan ID to replace on a subsequent push."),
    title: z.string().optional().describe("Recap title override."),
    brief: z.string().optional().describe("Recap brief override."),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the recap."),
    currentFocus: z
      .string()
      .optional()
      .default("visual recap review")
      .describe("Current focus for the review surface."),
    status: planStatusSchema.optional().default("review"),
    mdx: planMdxFileSchema.describe(
      "Recap source files. plan.mdx should contain grounded blocks derived from the real diff: file-tree, split diffs, columns, data-model, api-endpoint, realistic wireframes for UI changes, diagrams for architecture/data-flow changes, and short prose. Include WireframeBlock or canvas.mdx before/after wireframes whenever the diff changes rendered UI, layout, density, visual state, or interaction affordances. For comparable before/after UI states, put one standard WireframeBlock in each side of a Columns block labeled Before and After instead of stacking the wireframes vertically. Use the standard WireframeBlock/Screen renderer so the Plan viewer owns the surface, theme, and sketchy/clean toggle; keep renderMode unset or wireframe unless a design-only editable mock is explicitly required, and use --wf-* tokens, semantic controls, and rough targets such as data-rough/.wf-card/.wf-box/buttons/inputs/textareas. Let canvas artboards use surface preset sizing/auto-layout when possible; do not rely on custom width/height props to shrink desktop/browser frames, and render-check that artboards and labels do not overlap. Small UI surfaces must look like the real component: a popover change should use a popover surface with matching before/after geometry, a root wrapper with at least 14-16px of padding inside the bordered Screen, visible fields/options, and the changed control placed in its actual slot (for example a top-right header action stays in the top-right header). Do not use diagram blocks as stand-ins for rendered UI. Keep API endpoint groups in normal single-column document flow; use columns for API material only when it is an explicit before/after contract comparison. Diagram data.html/data.css should use renderer-owned .diagram-* primitives and --wf-* tokens instead of custom fonts or hard-coded hex/rgb/hsl colors, so light/dark and sketchy Virgil/rough.js modes remain correct.",
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Visual Recap",
    description:
      "Create a visual code-review recap from a real PR, branch, commit, or git diff.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Recap",
      description:
        "Open the Agent-Native Plans review surface for a visual code-review recap.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Recap",
      height: 860,
    }),
  },
  run: async (args) =>
    importVisualPlanSourceAction.run({
      ...args,
      source: args.source ?? "imported",
      currentFocus: args.currentFocus ?? "visual recap review",
      status: args.status ?? "review",
    }),
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Recap",
      view: "plan",
    };
  },
});
