import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view or dashboard. For filter changes (dashboard filter query params like ?f_date=...), use the framework-level `set-search-params` tool instead of this action.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (overview, ask, adhoc, analyses, extensions, catalog, data-dictionary, data-sources, settings)",
      ),
    dashboardId: z
      .string()
      .optional()
      .describe("Dashboard ID to open (used with view=adhoc)"),
    analysisId: z
      .string()
      .optional()
      .describe("Analysis ID to open (used with view=analyses)"),
    extensionId: z
      .string()
      .optional()
      .describe("Extension ID to open (used with view=extensions)"),
  }),
  http: false,
  run: async (args) => {
    if (
      !args.view &&
      !args.dashboardId &&
      !args.analysisId &&
      !args.extensionId
    ) {
      throw new Error(
        "At least --view, --dashboardId, --analysisId, or --extensionId is required.",
      );
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
    if (args.extensionId) {
      nav.extensionId = args.extensionId;
      if (!args.view) nav.view = "extensions";
    }
    await writeAppState("navigate", nav);

    const parts: string[] = [];
    if (nav.view) parts.push(nav.view);
    if (nav.dashboardId) parts.push(`dashboard:${nav.dashboardId}`);
    if (nav.analysisId) parts.push(`analysis:${nav.analysisId}`);
    if (nav.extensionId) parts.push(`extension:${nav.extensionId}`);
    return `Navigating to ${parts.join(" ")}`;
  },
});
