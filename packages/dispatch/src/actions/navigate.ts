/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=overview
 *   pnpm action navigate --view=<custom-dispatch-extension-id>
 *   pnpm action navigate --path=/some/route
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
    "Navigate the UI to a specific view or path. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "Named dispatch view to navigate to. Built-in views include overview, apps, new-app, vault, integrations, messaging, workspace, agents, destinations, identities, approvals, audit, and team. Generated Dispatch extension tabs can also use their nav item id.",
      ),
    path: z.string().optional().describe("URL path to navigate to"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      return "Error: At least --view or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || args.path}`;
  },
});
