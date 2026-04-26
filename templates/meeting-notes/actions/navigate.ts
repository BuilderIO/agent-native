/**
 * Navigate the UI to a view or a specific meeting / folder.
 *
 * Writes a navigate command to `application_state` which the UI reads and
 * auto-deletes. This is a one-shot command.
 *
 * Usage:
 *   pnpm action navigate --view=meetings
 *   pnpm action navigate --view=meeting --meetingId=<id>
 *   pnpm action navigate --view=people
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

const Views = [
  "meetings",
  "meeting",
  "people",
  "companies",
  "templates",
  "settings",
] as const;

export default defineAction({
  description:
    "Navigate the UI to a specific view or resource. Writes a one-shot navigate command to application state which the UI reads and auto-deletes. Prefer --view + ids; use --path only for arbitrary routes.",
  schema: z.object({
    view: z.enum(Views).optional().describe("Target view name"),
    meetingId: z.string().optional().describe("Meeting id -- for view=meeting"),
    folderId: z
      .string()
      .optional()
      .describe("Folder id -- for view=meetings scoped to a folder"),
    search: z
      .string()
      .optional()
      .describe("Search term (sets ?q=... on meetings list)"),
    path: z
      .string()
      .optional()
      .describe(
        "Raw URL path to navigate to (use only when a view/id combo does not express the target)",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      return "Error: at least --view or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.meetingId) nav.meetingId = args.meetingId;
    if (args.folderId) nav.folderId = args.folderId;
    if (args.search) nav.search = args.search;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    const target =
      args.path ||
      [args.view, args.meetingId, args.folderId].filter(Boolean).join(":");
    return `Navigating to ${target}`;
  },
});
