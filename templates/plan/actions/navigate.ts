/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=plans
 *   pnpm action navigate --view=plan --planId=plan_...
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
    "Navigate the Agent-Native Plans UI to the plan list or a specific visual plan.",
  schema: z.object({
    view: z
      .enum(["plans", "plan", "extensions", "team"])
      .optional()
      .describe("View name to navigate to"),
    planId: z.string().optional().describe("Plan to open"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.planId) {
      return "Error: At least --view or --planId is required.";
    }
    const nav: Record<string, string> = {};
    nav.view = args.view ?? "plan";
    if (args.planId) nav.planId = args.planId;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppState("navigate", nav);
    return `Navigating to ${nav.view}${args.planId ? ` (${args.planId})` : ""}`;
  },
});
