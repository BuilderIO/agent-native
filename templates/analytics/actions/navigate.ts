import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a specific view or dashboard, and/or change dashboard filters. Writes a navigate command to application state which the UI reads, applies, and auto-deletes. Dashboard filters live in the URL query string (?f_<id>=...) — to change, clear, or set them, pass a `filters` object here rather than editing the settings row.",
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
    filters: z
      .record(z.union([z.string(), z.null()]))
      .optional()
      .describe(
        "Dashboard filter values. Keys are filter ids from the dashboard config (or with Start/End suffix for date-range filters). Values replace the current URL query params — set to null or empty string to clear a filter. Example: { pubDateStart: null } clears the 'show recent articles only' filter; { cadence: 'MONTH' } switches to monthly grouping; { dateStart: '2026-01-01', dateEnd: '2026-04-01' } sets a date range.",
      ),
    keepOtherFilters: z
      .boolean()
      .optional()
      .describe(
        "If true (default), only the filter keys you pass are updated; others stay as they were. Set to false to replace the entire filter set with exactly what you passed.",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.dashboardId && !args.analysisId && !args.filters) {
      return "Error: At least --view, --dashboardId, --analysisId, or --filters is required.";
    }
    const nav: Record<string, unknown> = {};
    if (args.view) nav.view = args.view;
    if (args.dashboardId) {
      nav.dashboardId = args.dashboardId;
      if (!args.view) nav.view = "adhoc";
    }
    if (args.analysisId) {
      nav.analysisId = args.analysisId;
      if (!args.view) nav.view = "analyses";
    }
    if (args.filters) {
      nav.filters = args.filters;
      nav.keepOtherFilters = args.keepOtherFilters !== false;
    }
    await writeAppState("navigate", nav);

    const parts: string[] = [];
    if (nav.view) parts.push(String(nav.view));
    if (nav.dashboardId) parts.push(`dashboard:${nav.dashboardId}`);
    if (nav.analysisId) parts.push(`analysis:${nav.analysisId}`);
    if (args.filters) {
      const keys = Object.keys(args.filters);
      parts.push(`filters:${keys.length}`);
    }
    return `Navigating to ${parts.join(" ") || "(filter update)"}`;
  },
});
