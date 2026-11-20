import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { formsErrors } from "./_access.js";

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to open: home, workspace, form, editor, settings, agent, database, extensions or observability",
      ),
    path: z.string().optional().describe("URL path to navigate to"),
    formId: z
      .string()
      .optional()
      .describe("Form id for the form and editor views"),
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id for the workspace view"),
    tab: z
      .enum(["insights", "submissions", "share", "settings", "edit"])
      .optional()
      .describe("Form tab to open; defaults to insights"),
  }),
  outputSchema: z.string(),
  errors: formsErrors,
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      formsErrors.noWrite(
        "At least --view or --path is required.",
        "invalid_input",
      );
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.path) nav.path = args.path;
    if (args.formId) nav.formId = args.formId;
    if (args.workspaceId) nav.workspaceId = args.workspaceId;
    if (args.tab) nav.tab = args.tab;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}`;
  },
});
