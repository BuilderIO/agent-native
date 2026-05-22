/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=list
 *   pnpm action navigate --view=editor --designId=abc123
 *   pnpm action navigate --view=design-systems
 *   pnpm action navigate --view=design-systems --designSystemId=abc123
 *   pnpm action navigate --view=templates
 *   pnpm action navigate --view=settings
 *   pnpm action navigate --path=/some/route
 *
 * Options:
 *   --view       View name (list, editor, design-systems, present, templates, settings)
 *   --designId   Design ID (for editor/present views)
 *   --designSystemId Design system ID (for design-systems view)
 *   --path       URL path to navigate to
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Views: list, editor, design-systems, present, templates, settings. Use --designId with editor/present views and --designSystemId with design-systems.",
  schema: z.object({
    view: z
      .enum([
        "list",
        "editor",
        "design-systems",
        "present",
        "templates",
        "examples",
        "settings",
      ])
      .optional()
      .describe("View name to navigate to"),
    designId: z.string().optional().describe("Design ID for editor/present"),
    designSystemId: z
      .string()
      .optional()
      .describe("Design system ID for design-systems view"),
    path: z.string().optional().describe("URL path to navigate to"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      return "Error: At least --view or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.designId) nav.designId = args.designId;
    if (args.designSystemId) nav.designSystemId = args.designSystemId;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || args.path}${
      args.designId ? ` (design: ${args.designId})` : ""
    }${args.designSystemId ? ` (design system: ${args.designSystemId})` : ""}`;
  },
});
