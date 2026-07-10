/**
 * Navigate the UI to a view.
 *
 * Usage:
 *   pnpm action navigate --view=tasks
 *   pnpm action navigate --view=tasks --includeDone=true
 *   pnpm action navigate --view=tasks --taskId=<id>
 *   pnpm action navigate --view=fields
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { NAV_VIEWS } from "../shared/navigation.js";
import { optionalBooleanQueryParam } from "./lib/boolean-query-param.js";

const viewSchema = z.enum(NAV_VIEWS);

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: viewSchema.optional().describe("View name to navigate to"),
    path: z.string().optional().describe("URL path to navigate to"),
    taskId: z.string().optional().describe("Selected task id on /tasks"),
    fieldId: z
      .string()
      .optional()
      .describe("Selected custom field id on /fields"),
    includeDone: optionalBooleanQueryParam().describe(
      "When true, show completed tasks on /tasks",
    ),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("At least --view or --path is required.");
    }
    const nav: Record<string, string | boolean> = {};
    if (args.view) nav.view = args.view;
    if (args.path) nav.path = args.path;
    if (args.taskId) nav.taskId = args.taskId;
    if (args.fieldId) nav.fieldId = args.fieldId;
    if (args.includeDone !== undefined) nav.includeDone = args.includeDone;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}`;
  },
});
