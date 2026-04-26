/**
 * Navigate the UI to a view or a specific page.
 *
 * Writes a navigate command to `application_state` which the UI reads and
 * auto-deletes. This is a one-shot command — it will not persist across
 * navigations.
 *
 * Usage:
 *   pnpm action navigate --view=home
 *   pnpm action navigate --view=snippets
 *   pnpm action navigate --view=dictionary
 *   pnpm action navigate --view=settings
 *   pnpm action navigate --path=/stats
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

const Views = [
  "home",
  "dictation",
  "snippets",
  "dictionary",
  "styles",
  "stats",
  "settings",
] as const;

export default defineAction({
  description:
    "Navigate the UI to a specific view. Writes a one-shot navigate command to application state which the UI reads and auto-deletes. Prefer --view; use --path only for arbitrary routes.",
  schema: z.object({
    view: z.enum(Views).optional().describe("Target view name"),
    dictationId: z
      .string()
      .optional()
      .describe("Dictation ID — for view=dictation"),
    path: z
      .string()
      .optional()
      .describe(
        "Raw URL path to navigate to (use only when a view combo does not express the target)",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      return "Error: at least --view or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.dictationId) nav.dictationId = args.dictationId;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    const target =
      args.path || [args.view, args.dictationId].filter(Boolean).join(":");
    return `Navigating to ${target}`;
  },
});
