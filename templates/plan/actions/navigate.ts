/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=chat
 *   pnpm action navigate --view=plans
 *   pnpm action navigate --view=plan --planId=plan_...
 *   pnpm action navigate --view=plan --localPlanSlug=checkout-review
 *   pnpm action navigate --view=plan --localPlanSlug=checkout-review --localPlanPath=plans/checkout-review
 *
 * Options:
 *   --view   View name to navigate to
 *   --path   URL path to navigate to
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the Agent-Native Plan UI to Ask Plan chat, the plan list, or a specific visual plan.",
  schema: z.object({
    view: z
      .enum(["chat", "plans", "plan", "extensions", "team"])
      .optional()
      .describe("View name to navigate to"),
    planId: z.string().optional().describe("Plan to open"),
    localPlanSlug: z
      .string()
      .optional()
      .describe("Local MDX plan folder slug to open under /local-plans/:slug"),
    localPlanPath: z
      .string()
      .optional()
      .describe("Optional repo-relative folder path for a local MDX plan"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.planId && !args.localPlanSlug) {
      return "Error: At least --view, --planId, or --localPlanSlug is required.";
    }
    const nav: Record<string, string> = {};
    nav.view = args.view ?? "plan";
    if (args.planId) nav.planId = args.planId;
    if (args.localPlanSlug) nav.localPlanSlug = args.localPlanSlug;
    if (args.localPlanPath) nav.localPlanPath = args.localPlanPath;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppState("navigate", nav);
    return `Navigating to ${nav.view}${
      args.localPlanSlug
        ? ` (local ${args.localPlanSlug})`
        : args.planId
          ? ` (${args.planId})`
          : ""
    }`;
  },
});
