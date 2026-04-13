import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a specific view or dashboard. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (overview, adhoc, analyses, query, data-sources, settings)",
      ),
    dashboardId: z
      .string()
      .optional()
      .describe("Dashboard ID to open (used with view=adhoc)"),
    analysisId: z
      .string()
      .optional()
      .describe("Analysis ID to open (used with view=analyses)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.dashboardId && !args.analysisId) {
      return "Error: At least --view, --dashboardId, or --analysisId is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.dashboardId) {
      nav.dashboardId = args.dashboardId;
      if (!args.view) nav.view = "adhoc";
    }
    if (args.analysisId) {
      nav.analysisId = args.analysisId;
      if (!args.view) nav.view = "analyses";
    }
    await writeAppState("navigate", nav);

    const parts: string[] = [];
    if (nav.view) parts.push(nav.view);
    if (nav.dashboardId) parts.push(`dashboard:${nav.dashboardId}`);
    if (nav.analysisId) parts.push(`analysis:${nav.analysisId}`);
    return `Navigating to ${parts.join(" ")}`;
  },
});
