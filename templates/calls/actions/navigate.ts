/**
 * Navigate the UI to a view or a specific call / snippet / folder / space /
 * share / invite. Writes a one-shot `navigate` command the UI reads and
 * auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=library
 *   pnpm action navigate --view=call --callId=<id>
 *   pnpm action navigate --view=snippet --snippetId=<id>
 *   pnpm action navigate --path=/c/cal_abc
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

const Views = [
  "library",
  "call",
  "snippet",
  "search",
  "trackers",
  "upload",
  "archive",
  "trash",
  "settings",
  "notifications",
  "share",
  "embed",
  "invite",
] as const;

export default defineAction({
  description:
    "Navigate the UI to a specific view or resource. Writes a one-shot `navigate` command to application state — the UI reads it and auto-deletes. Prefer --view + ids; use --path only for arbitrary routes.",
  schema: z.object({
    view: z.enum(Views).optional().describe("Target view name"),
    callId: z
      .string()
      .optional()
      .describe("Call id — for view=call, view=share, view=embed"),
    snippetId: z.string().optional().describe("Snippet id — for view=snippet"),
    folderId: z
      .string()
      .optional()
      .describe("Folder id — for view=library scoped to a folder"),
    spaceId: z
      .string()
      .optional()
      .describe("Space id — for view=library scoped to a space"),
    shareId: z
      .string()
      .optional()
      .describe("Share id — for view=share or view=embed"),
    search: z
      .string()
      .optional()
      .describe("Search term — sets ?q= on library/search"),
    path: z
      .string()
      .optional()
      .describe(
        "Raw URL path to navigate to — only when a view/id combo does not express the target",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      return "Error: at least --view or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.callId) nav.callId = args.callId;
    if (args.snippetId) nav.snippetId = args.snippetId;
    if (args.folderId) nav.folderId = args.folderId;
    if (args.spaceId) nav.spaceId = args.spaceId;
    if (args.shareId) nav.shareId = args.shareId;
    if (args.search) nav.search = args.search;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    const target =
      args.path ||
      [
        args.view,
        args.callId,
        args.snippetId,
        args.folderId,
        args.spaceId,
        args.shareId,
      ]
        .filter(Boolean)
        .join(":");
    return `Navigating to ${target}`;
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
