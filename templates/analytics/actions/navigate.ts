import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view, dashboard, analysis, extension, or Analytics session recording. For filter changes (dashboard filter query params like ?f_date=... or session filters like ?range=30d&q=signup), use the framework-level `set-search-params` tool instead of this action.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (ask, adhoc, analyses, extensions, sessions, catalog, data-dictionary, data-sources, settings)",
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
    recordingId: z
      .string()
      .optional()
      .describe("Session recording id to open (used with view=sessions)"),
  }),
  http: false,
  run: async (args) => {
    if (
      !args.view &&
      !args.dashboardId &&
      !args.analysisId &&
      !args.extensionId &&
      !args.recordingId
    ) {
      throw new Error(
        "At least --view, --dashboardId, --analysisId, --extensionId, or --recordingId is required.",
      );
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view === "overview" ? "ask" : args.view;
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
    if (args.recordingId) {
      nav.recordingId = args.recordingId;
      if (!args.view) nav.view = "sessions";
    }
    await writeAppState("navigate", nav);

    const parts: string[] = [];
    if (nav.view) parts.push(nav.view);
    if (nav.dashboardId) parts.push(`dashboard:${nav.dashboardId}`);
    if (nav.analysisId) parts.push(`analysis:${nav.analysisId}`);
    if (nav.extensionId) parts.push(`extension:${nav.extensionId}`);
    if (nav.recordingId) parts.push(`recording:${nav.recordingId}`);
    return `Navigating to ${parts.join(" ")}`;
  },
});
