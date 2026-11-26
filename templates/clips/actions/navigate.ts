import { defineAction, fail } from "@agent-native/core/action";
import {
  navigationIntentSchema,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { getUserLabEnabled } from "@agent-native/core/labs/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { CLIPS_MEETINGS } from "../shared/labs.js";
import { unreadLibraryFilterParts } from "../shared/library-filters.js";

const Views = [
  "library",
  "shared",
  "spaces",
  "space",
  "from-content",
  "archive",
  "trash",
  "record",
  "bug-report",
  "bug-report-done",
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

function targetsMeetings(args: {
  view?: (typeof Views)[number];
  path?: string;
}): boolean {
  if (args.view === "meetings" || args.view === "meeting") return true;
  const path = args.path?.trim().split(/[?#]/)[0] ?? "";
  return path === "/meetings" || path.startsWith("/meetings/");
}

export default defineAction({
  description:
    "Navigate the UI to a specific view or resource. A nonempty view or path is required; prefer view with ids, and use path only for arbitrary routes.",
  schema: z
    .object({
      view: z
        .enum(Views)
        .optional()
        .describe(
          "Target view name; required unless a nonempty path is provided",
        ),
      recordingId: z
        .string()
        .optional()
        .describe("Recording id — for view=recording or view=insights"),
      meetingId: z
        .string()
        .optional()
        .describe("Meeting id — for view=meeting"),
      meetingsTab: z
        .enum(["agenda", "past"])
        .optional()
        .describe("Meetings tab — for view=meetings ('agenda' or 'past')"),
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
      filters: z
        .string()
        .optional()
        .describe(
          "For view=library: the Library's filter, written as the query of a Library link, such as source=content or source=all&r=madeBy:equals:agent. See list-recordings' filters for the fields.",
        ),
      panel: z
        .enum([
          "comments",
          "transcript",
          "agent",
          "debug",
          "insights",
          "settings",
        ])
        .optional()
        .describe("Viewer panel to focus when opening a recording"),
      atMs: z.coerce
        .number()
        .min(0)
        .optional()
        .describe(
          "Playback timestamp in milliseconds when opening a recording",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Nonempty raw URL path; required unless view is provided. Use only when a view/id combo does not express the target",
        ),
      intent: navigationIntentSchema,
    })
    .refine((args) => Boolean(args.view || args.path?.trim()), {
      message: "A nonempty view or path is required",
    }),
  http: false,
  mcpTool: "search",
  run: async (args) => {
    const path = args.path?.trim() ? args.path : undefined;
    if (targetsMeetings({ view: args.view, path })) {
      const userEmail = getRequestUserEmail();
      const orgId = getRequestOrgId();
      if (
        userEmail &&
        !(await getUserLabEnabled(userEmail, CLIPS_MEETINGS, {
          userEmail,
          orgId,
        }))
      ) {
        return "Did not navigate: Meetings is a Lab that is turned off, so the meetings pages would redirect to the library. Answer from list-meetings or search-meetings, or tell the user to turn on Meetings and transcription in Settings › Labs, then navigate.";
      }
    }
    const nav: Record<string, string | number> = {};
    if (args.view) nav.view = args.view;
    if (args.recordingId) nav.recordingId = args.recordingId;
    if (args.meetingId) nav.meetingId = args.meetingId;
    if (args.meetingsTab) nav.meetingsTab = args.meetingsTab;
    if (args.dictationId) nav.dictationId = args.dictationId;
    if (args.spaceId) nav.spaceId = args.spaceId;
    if (args.folderId) nav.folderId = args.folderId;
    if (args.shareId) nav.shareId = args.shareId;
    if (args.search) nav.search = args.search;
    if (args.filters) {
      const unread = unreadLibraryFilterParts(args.filters);
      if (unread.length > 0) {
        fail(
          `Library's filter can't read ${unread.join(", ")}. See list-recordings' filters for the fields and values.`,
          { errorCode: "invalid_filters", details: { unread } },
        );
      }
      nav.filters = args.filters;
    }
    if (args.panel) nav.panel = args.panel;
    if (args.atMs != null) nav.atMs = args.atMs;
    if (path) nav.path = path;
    await writeAppStateForCurrentTab("navigate", nav);
    const target =
      path ||
      [
        args.view,
        args.recordingId,
        args.meetingId,
        args.meetingsTab,
        args.dictationId,
        args.spaceId,
        args.folderId,
        args.shareId,
        args.panel,
        args.atMs,
      ]
        .filter(Boolean)
        .join(":");
    return `Navigating to ${target}`;
  },
});
