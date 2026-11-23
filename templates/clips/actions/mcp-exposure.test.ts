import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  recording: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: vi.fn(async () =>
    stored.recording ? { role: "owner", resource: stored.recording } : null,
  ),
}));

vi.mock("../server/lib/transcript-versions.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/transcript-versions.js")
  >()),
  hasImportedTranscript: vi.fn(
    async () => stored.recording?.transcript === "imported",
  ),
  hasFinishedNativeTranscript: vi.fn(
    async () => stored.recording?.transcript === "finished",
  ),
}));

const SERVED = [
  "add-comment",
  "add-vocabulary-term",
  "cleanup-dictation",
  "cleanup-transcript",
  "complete-workflow",
  "create-cta",
  "create-dictation",
  "create-folder",
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
  "remove-vocabulary-term",
  "rename-folder",
  "rename-space",
  "reprocess-recording",
  "resolve-comment",
  "search-dictations",
  "set-recording-trims",
  "set-thumbnail",
  "split-recording",
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
  "get-screen-memory-status",
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
  "sync-calendars",
  "update-ai-request-status",
  "update-clips-ai-prefs",
  "update-clips-notification-prefs",
  "update-clips-recording-defaults",
  "update-recording-context",
] as const;

const REDACTION = {
  id: "box-1",
  kind: "redact",
  style: "solid",
  startMs: 0,
  endMs: 1000,
  keys: [{ atMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
};
const REDACTED = { editsJson: JSON.stringify({ overlays: [REDACTION] }) };
const IMPORTED = { transcript: "imported" };
const FINISHED = { transcript: "finished" };
const EXPIRES = "2026-12-01T00:00:00.000Z";
const LATER = "2026-12-31T00:00:00.000Z";
const SOONER = "2026-11-25T00:00:00.000Z";

const WIDENS_ACCESS = [
  ["update-recording", { id: "rec-1", spaceIds: ["space-1"] }, null],
  ["update-recording", { id: "rec-1", spaceIds: [] }, null],
  ["update-recording", { id: "rec-1", password: null }, null],
  ["update-recording", { id: "rec-1", password: "   " }, null],
  ["update-recording", { id: "rec-1", expiresAt: null }, null],
  [
    "update-recording",
    { id: "rec-1", password: "new-password" },
    { password: "stored-password", expiresAt: null },
  ],
  [
    "update-recording",
    { id: "rec-1", expiresAt: LATER },
    { password: null, expiresAt: EXPIRES },
  ],
  [
    "update-recording",
    { id: "rec-1", enableDownloads: true },
    { enableDownloads: false },
  ],
  [
    "update-recording",
    { id: "rec-1", enableComments: true },
    { enableComments: false },
  ],
  ["update-meeting", { id: "meeting-1", visibility: "org" }, null],
  ["update-meeting", { id: "meeting-1", visibility: "public" }, null],
  ["update-meeting", { id: "meeting-1", shareTranscript: true }, null],
  ["stitch-recordings", { sourceRecordingIds: ["rec-1", "rec-2"] }, null],
  [
    "stitch-recordings",
    { sourceRecordingIds: ["rec-1", "rec-2"], visibility: "public" },
    null,
  ],
  ["create-meeting", { calendarEventId: "event-1" }, null],
  ["create-meeting", { calendarEventId: "event-1", visibility: "org" }, null],
  ["set-recording-overlays", { recordingId: "rec-1", overlays: [] }, REDACTED],
  [
    "set-recording-overlays",
    { recordingId: "rec-1", overlays: "[]" },
    REDACTED,
  ],
  [
    "set-recording-overlays",
    { recordingId: "rec-1", overlays: [{ ...REDACTION, endMs: 500 }] },
    REDACTED,
  ],
  [
    "set-recording-overlays",
    {
      recordingId: "rec-1",
      overlays: [
        { ...REDACTION, keys: [{ atMs: 0, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] },
      ],
    },
    REDACTED,
  ],
  [
    "set-recording-overlays",
    { recordingId: "rec-1", overlays: [{ ...REDACTION, style: "mosaic" }] },
    REDACTED,
  ],
  ["request-transcript", { recordingId: "rec-1", regenerate: true }, IMPORTED],
  [
    "save-browser-transcript",
    { recordingId: "rec-1", fullText: "Hello", overwriteReady: true },
    FINISHED,
  ],
] as const;

const KEEPS_ACCESS = [
  ["update-recording", { id: "rec-1", title: "Renamed" }, null],
  [
    "update-recording",
    { id: "rec-1", password: "share-password" },
    { password: null, expiresAt: null },
  ],
  [
    "update-recording",
    { id: "rec-1", expiresAt: EXPIRES },
    { password: null, expiresAt: null },
  ],
  [
    "update-recording",
    { id: "rec-1", expiresAt: SOONER },
    { password: null, expiresAt: EXPIRES },
  ],
  ["update-recording", { id: "rec-1", expiresAt: LATER }, null],
  [
    "update-recording",
    { id: "rec-1", enableDownloads: true, enableComments: true },
    { enableDownloads: true, enableComments: true },
  ],
  [
    "update-recording",
    { id: "rec-1", enableDownloads: false, enableComments: false },
    null,
  ],
  ["update-meeting", { id: "meeting-1", userNotesMd: "Notes" }, null],
  ["update-meeting", { id: "meeting-1", visibility: "private" }, null],
  ["update-meeting", { id: "meeting-1", shareTranscript: false }, null],
  [
    "stitch-recordings",
    { sourceRecordingIds: ["rec-1", "rec-2"], visibility: "private" },
    null,
  ],
  ["create-meeting", { title: "Standup" }, null],
  [
    "create-meeting",
    { calendarEventId: "event-1", visibility: "private" },
    null,
  ],
  [
    "set-recording-overlays",
    { recordingId: "rec-1", overlays: [REDACTION] },
    REDACTED,
  ],
  [
    "set-recording-overlays",
    {
      recordingId: "rec-1",
      overlays: [REDACTION, { ...REDACTION, id: "box-2" }],
    },
    REDACTED,
  ],
  [
    "set-recording-overlays",
    { recordingId: "rec-1", overlays: [] },
    { editsJson: null },
  ],
  ["request-transcript", { recordingId: "rec-1" }, IMPORTED],
  ["request-transcript", { recordingId: "rec-1", regenerate: true }, {}],
  ["request-transcript", { recordingId: "rec-1", regenerate: true }, null],
  ["save-browser-transcript", { recordingId: "rec-1", fullText: "Hello" }, {}],
  [
    "save-browser-transcript",
    { recordingId: "rec-1", fullText: "Hello", overwriteReady: true },
    IMPORTED,
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
    async (name, args, recording) => {
      stored.recording = recording;
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
    async (name, args, recording) => {
      stored.recording = recording;
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
