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

import {
  NAV_VIEW_INPUTS,
  pathForView,
  resolveNavView,
} from "../shared/navigation.js";
import { optionalBooleanQueryParam } from "./lib/boolean-query-param.js";

const viewSchema = z.enum(NAV_VIEW_INPUTS);

export const navigateSchema = z.object({
  view: viewSchema.describe(
    "View name to navigate to; home and ask are aliases for tasks",
  ),
  taskId: z.string().optional().describe("Selected task id on /tasks"),
  fieldId: z
    .string()
    .optional()
    .describe("Selected custom field id on /fields"),
  includeDone: optionalBooleanQueryParam().describe(
    "When true, show completed tasks on /tasks",
  ),
});

export default defineAction({
  description:
    "Navigate the Tasks UI to a view, optionally selecting a task or custom field.",
  schema: navigateSchema,
  http: false,
  run: async (args) => {
    const view = resolveNavView(args.view);
    const nav: Record<string, string | boolean> = { view };
    if (args.taskId) nav.taskId = args.taskId;
    if (args.fieldId) nav.fieldId = args.fieldId;
    if (args.includeDone !== undefined) nav.includeDone = args.includeDone;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${pathForView(view)}`;
  },
});
