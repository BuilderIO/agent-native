import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

const SERVED = [
  "add-comment",
  "add-vocabulary-term",
  "cleanup-dictation",
  "cleanup-transcript",
  "complete-workflow",
  "create-cta",
  "create-dictation",
  "create-folder",
  "create-meeting",
  "create-recording",
  "create-space",
  "export-insights-csv",
  "finalize-meeting",
  "finalize-recording",
  "generate-filmstrip",
  "generate-workflow",
  "get-invite",
  "get-organization-insights",
  "get-recording-app-activity",
  "get-recording-insights",
  "get-screen-memory-status",
  "get-video-storage-status",
  "list-ai-requests",
  "list-clip-views",
  "list-dictations",
  "list-notifications",
  "list-organization-state",
  "list-recording-context",
  "list-recording-mention-members",
  "list-recording-tags",
  "list-viewers",
  "list-vocabulary",
  "make-recording-private-for-rewind",
  "move-recording",
  "prepare-crm-call-evidence",
  "react-to-comment",
  "react-to-recording",
  "regenerate-chapters",
  "regenerate-summary",
  "regenerate-title",
  "remove-filler-words",
  "remove-silences",
  "rename-folder",
  "rename-space",
  "reprocess-recording",
  "request-transcript",
  "resolve-comment",
  "save-browser-transcript",
  "search-dictations",
  "set-recording-overlays",
  "set-recording-trims",
  "set-thumbnail",
  "split-recording",
  "sync-calendars",
  "trim-recording",
  "undo-edit",
  "update-comment",
  "update-cta",
  "update-dictation",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "accept-invite",
  "add-space-member",
  "clear-edits",
  "create-organization",
  "decline-invite",
  "delete-comment",
  "delete-cta",
  "delete-dictation",
  "delete-folder",
  "delete-meeting",
  "delete-space",
  "export-to-brain",
  "remove-earlier-meeting-audio",
  "remove-space-member",
  "remove-vocabulary-term",
  "set-organization-branding",
] as const;

const ALWAYS_APPROVED = [
  "invite-member",
  "remove-member",
  "update-member-role",
] as const;

const IN_APP_ONLY = [
  "complete-transactional-email-summary",
  "connect-calendar",
  "connect-slack",
  "consume-ai-request",
  "create-recording-agent-link",
  "delete-agent-recording-if-unpromoted",
  "disconnect-calendar",
  "disconnect-slack",
  "get-builder-credit-status",
  "get-clips-ai-prefs",
  "get-clips-notification-prefs",
  "get-clips-recording-defaults",
  "list-calendar-accounts",
  "list-pending-recording-context",
  "list-recording-media-cleanups",
  "list-slack-installations",
  "query-screen-memory-context",
  "refresh-list",
  "remove-recording-context",
  "request-recording-context",
  "retry-recording-media-cleanup",
  "set-embed-duration",
  "set-recording-context-window",
  "start-meeting-recording",
  "stop-meeting-recording",
  "update-ai-request-status",
  "update-clips-ai-prefs",
  "update-clips-notification-prefs",
  "update-clips-recording-defaults",
  "update-recording-context",
] as const;

const WIDENS_ACCESS = [
  ["update-recording", { id: "rec-1", spaceIds: ["space-1"] }],
  ["update-recording", { id: "rec-1", spaceIds: [] }],
  ["update-recording", { id: "rec-1", password: null }],
  ["update-recording", { id: "rec-1", expiresAt: null }],
  ["update-meeting", { id: "meeting-1", visibility: "org" }],
  ["update-meeting", { id: "meeting-1", visibility: "public" }],
  ["update-meeting", { id: "meeting-1", shareTranscript: true }],
  ["stitch-recordings", { sourceRecordingIds: ["rec-1", "rec-2"] }],
  [
    "stitch-recordings",
    { sourceRecordingIds: ["rec-1", "rec-2"], visibility: "public" },
  ],
] as const;

const KEEPS_ACCESS = [
  ["update-recording", { id: "rec-1", title: "Renamed" }],
  ["update-recording", { id: "rec-1", password: "share-password" }],
  ["update-recording", { id: "rec-1", expiresAt: "2026-12-01T00:00:00.000Z" }],
  ["update-meeting", { id: "meeting-1", userNotesMd: "Notes" }],
  ["update-meeting", { id: "meeting-1", visibility: "private" }],
  ["update-meeting", { id: "meeting-1", shareTranscript: false }],
  [
    "stitch-recordings",
    { sourceRecordingIds: ["rec-1", "rec-2"], visibility: "private" },
  ],
] as const;

type Exposure = {
  mcpTool?: boolean | "search";
  needsApproval?:
    | boolean
    | ((args: unknown, ctx?: ActionRunContext) => boolean | Promise<boolean>);
};

async function load(name: string): Promise<Exposure> {
  return ((await import(`./${name}.ts`)) as { default: Exposure }).default;
}

describe("Clips actions over MCP", () => {
  it.each(SERVED)(
    "serves %s to outside agents through tool-search",
    async (name) => {
      const action = await load(name);
      expect(action.mcpTool).toBe("search");
      expect(action.needsApproval).toBeUndefined();
    },
  );

  it.each(APPROVED_WHEN_OUTSIDE)(
    "serves %s through tool-search, and asks only outside agents to approve it",
    async (name) => {
      const action = await load(name);
      expect(action.mcpTool).toBe("search");
      const approves = action.needsApproval;
      if (typeof approves !== "function") {
        throw new Error(`${name} has no approval rule`);
      }
      expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
        false,
      );
      expect(
        await approves({}, { caller: "frontend" } as ActionRunContext),
      ).toBe(false);
      expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(
        true,
      );
    },
  );

  it.each(WIDENS_ACCESS)(
    "serves %s through tool-search, and asks an outside agent first for %o",
    async (name, args) => {
      const action = await load(name);
      expect(action.mcpTool).toBe("search");
      const approves = action.needsApproval;
      if (typeof approves !== "function") {
        throw new Error(`${name} has no approval rule`);
      }
      expect(await approves(args, { caller: "mcp" } as ActionRunContext)).toBe(
        true,
      );
      expect(await approves(args, { caller: "tool" } as ActionRunContext)).toBe(
        false,
      );
    },
  );

  it.each(KEEPS_ACCESS)(
    "lets an outside agent call %s without asking for %o",
    async (name, args) => {
      const approves = (await load(name)).needsApproval;
      if (typeof approves !== "function") {
        throw new Error(`${name} has no approval rule`);
      }
      expect(await approves(args, { caller: "mcp" } as ActionRunContext)).toBe(
        false,
      );
    },
  );

  it.each(ALWAYS_APPROVED)(
    "serves %s through tool-search, still asking on every agent call",
    async (name) => {
      const action = await load(name);
      expect(action.mcpTool).toBe("search");
      expect(action.needsApproval).toBe(true);
    },
  );

  it.each(IN_APP_ONLY)("keeps %s in the app, off MCP", async (name) => {
    expect((await load(name)).mcpTool).toBe(false);
  });
});
