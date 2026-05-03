/**
 * Navigate the UI to a view or a specific recording / space / folder / share.
 *
 * Writes a navigate command to `application_state` which the UI reads and
 * auto-deletes. This is a one-shot command — it will not persist across
 * navigations.
 *
 * Usage:
 *   pnpm action navigate --view=library
 *   pnpm action navigate --view=recording --recordingId=<id>
 *   pnpm action navigate --view=meeting --meetingId=<id>
 *   pnpm action navigate --view=dictate
 *   pnpm action navigate --view=space --spaceId=<id>
 *   pnpm action navigate --path=/r/rec_abc
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

const Views = [
  "library",
  "spaces",
  "space",
  "archive",
  "trash",
  "record",
  "recording",
  "meetings",
  "meeting",
  "dictate",
  "share",
  "embed",
  "insights",
  "notifications",
  "settings",
] as const;

export default defineAction({
  description:
    "Navigate the UI to a specific view or resource. Writes a one-shot navigate command to application state which the UI reads and auto-deletes. Prefer --view + ids; use --path only for arbitrary routes.",
  schema: z.object({
    view: z.enum(Views).optional().describe("Target view name"),
    recordingId: z
      .string()
      .optional()
      .describe("Recording id — for view=recording or view=insights"),
    meetingId: z.string().optional().describe("Meeting id — for view=meeting"),
    dictationId: z
      .string()
      .optional()
      .describe(
        "Dictation id — for view=dictate if a specific dictation is open",
      ),
    spaceId: z.string().optional().describe("Space id — for view=space"),
    folderId: z
      .string()
      .optional()
      .describe("Folder id — for view=library scoped to a folder"),
    shareId: z
      .string()
      .optional()
      .describe("Share id — for view=share or view=embed"),
    search: z
      .string()
      .optional()
      .describe("Library search term (sets ?q=… on library/space)"),
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
    if (args.recordingId) nav.recordingId = args.recordingId;
    if (args.meetingId) nav.meetingId = args.meetingId;
    if (args.dictationId) nav.dictationId = args.dictationId;
    if (args.spaceId) nav.spaceId = args.spaceId;
    if (args.folderId) nav.folderId = args.folderId;
    if (args.shareId) nav.shareId = args.shareId;
    if (args.search) nav.search = args.search;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    const target =
      args.path ||
      [
        args.view,
        args.recordingId,
        args.meetingId,
        args.dictationId,
        args.spaceId,
        args.folderId,
        args.shareId,
      ]
        .filter(Boolean)
        .join(":");
    return `Navigating to ${target}`;
  },
});
