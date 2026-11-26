import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appStateDelete,
  appStateGet,
} from "@agent-native/core/application-state";
import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  insertValues: vi.fn(),
  dispatchPostFinalizeJob: vi.fn(),
  trackRecordingCreated: vi.fn(),
  validateRecordingScope: vi.fn(),
  resolveClipsVideoStorage: vi.fn(),
  hasRequestVideoStorage: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mocks.ssrfSafeFetch(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.insertValues }),
  }),
  schema: { recordings: {}, recordingTranscripts: {} },
}));

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mocks.dispatchPostFinalizeJob(...args),
}));

vi.mock("../server/lib/recording-created.js", () => ({
  trackRecordingCreated: (...args: unknown[]) =>
    mocks.trackRecordingCreated(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => USER_EMAIL,
  getDefaultRecordingVisibility: async () => "org",
  nanoid: () => mocks.nanoid(),
  ownerEmailMatches: vi.fn(),
  parseSpaceIds: () => [],
  requireOrganizationAccess: async () => ({ organizationId: "org-1" }),
  stringifySpaceIds: (ids: string[]) => JSON.stringify(ids),
}));

vi.mock("../server/lib/video-storage.js", () => ({
  consumeHostedClipRecording: vi.fn(),
  hasRequestVideoStorage: () => mocks.hasRequestVideoStorage(),
  releaseHostedClipRecording: vi.fn(),
  resolveClipsVideoStorage: (...args: unknown[]) =>
    mocks.resolveClipsVideoStorage(...args),
  STORAGE_SETUP_REQUIRED_REASON: "Connect storage first.",
  verifyHostedClipMedia: vi.fn(),
}));

vi.mock("./lib/recording-scope.js", () => ({
  validateRecordingScope: (...args: unknown[]) =>
    mocks.validateRecordingScope(...args),
}));

import importLoomRecording from "./import-loom-recording.js";

const USER_EMAIL = "person@example.com";
const TAB_ID = "clips-tab-1";
const TEMP_DB_DIR = mkdtempSync(join(tmpdir(), "clips-import-keepview-"));
const PREVIOUS_DB_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = `pglite:${TEMP_DB_DIR}`;

async function inTab<T>(fn: () => T | Promise<T>): Promise<T> {
  return await runWithRequestContext(
    {
      userEmail: USER_EMAIL,
      run: { browserTabId: TAB_ID },
    },
    fn,
  );
}

describe("import-loom-recording keeps the user's view for agent callers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await appStateDelete(USER_EMAIL, `navigate:${TAB_ID}`);
    await appStateDelete(USER_EMAIL, "navigate");
    mocks.validateRecordingScope.mockResolvedValue([]);
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.dispatchPostFinalizeJob.mockResolvedValue(undefined);
    mocks.hasRequestVideoStorage.mockResolvedValue(false);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "none",
      provider: null,
      denyReason: "disabled",
    });
    mocks.nanoid.mockReturnValue("rec-mcp-1");
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "video",
          html: "<iframe />",
          title: "Imported demo",
          width: 1280,
          height: 720,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  afterAll(async () => {
    await closeDbExec();
    if (PREVIOUS_DB_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = PREVIOUS_DB_URL;
    }
    rmSync(TEMP_DB_DIR, { recursive: true, force: true });
  });

  it("succeeds over MCP without throwing or moving the user's view", async () => {
    const result = await inTab(() =>
      importLoomRecording.run(
        { url: "https://www.loom.com/share/abcdef1234567890abcdef1234567890" },
        { caller: "mcp", actionName: "import-loom-recording" },
      ),
    );

    expect(result).toMatchObject({
      recordingId: "rec-mcp-1",
      provider: "loom",
    });
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
    expect(await appStateGet(USER_EMAIL, "navigate")).toBeNull();
  });

  it("still opens the imported clip when a person runs it from the UI", async () => {
    mocks.nanoid.mockReturnValue("rec-ui-1");

    const result = await inTab(() =>
      importLoomRecording.run(
        { url: "https://youtu.be/jNQXAC9IVRw" },
        { caller: "frontend", actionName: "import-loom-recording" },
      ),
    );

    expect(result).toMatchObject({
      recordingId: "rec-ui-1",
      provider: "youtube",
    });
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toMatchObject({
      view: "recording",
      recordingId: "rec-ui-1",
    });
  });
});
