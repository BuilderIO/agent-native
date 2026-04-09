/**
 * Navigate the UI to a composition or the studio home.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=home
 *   pnpm action navigate --compositionId=logo-reveal
 *
 * Options:
 *   --view            Navigate to a top-level view ("home", "components")
 *   --compositionId   Composition ID to open
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a specific composition or view. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe("Top-level view to navigate to (home, components)"),
    compositionId: z.string().optional().describe("Composition ID to open"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.compositionId) {
      return "Error: At least --view or --compositionId is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.compositionId) nav.compositionId = args.compositionId;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || ""}${args.compositionId ? ` composition:${args.compositionId}` : ""}`;
  },
});
