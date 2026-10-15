import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardAnnotationScope } from "../server/lib/dashboard-annotation-scope.js";
import {
  listKeyDateSets,
  requireKeyDateScope,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  description:
    "List the organization's key-date sets (for example Launches, Product changes) by name, each with its dates oldest first. Every set shows on every time chart of every dashboard unless that dashboard hides it in config.annotations.hiddenKeyDateSets. Read-only.",
  schema: z.object({
    dashboardId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "List the sets this dashboard draws: its owner organization's. editable is false when they aren't yours to change.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async ({ dashboardId }) => {
    const caller = requireKeyDateScope();
    const { scope, editable } = dashboardId
      ? await dashboardAnnotationScope(dashboardId, caller)
      : { scope: caller, editable: true };
    return { sets: await listKeyDateSets(scope), editable };
  },
});
