import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureEnabledAt: vi.fn(),
  enqueue: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  ownerEmailMatches: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  inArray: vi.fn(),
  defineAction: vi.fn((options: unknown) => options),
  writeAppState: vi.fn(),
  writeAppStateForCurrentTab: vi.fn(),
  uploadFile: vi.fn(),
  getDb: vi.fn(),
  getCurrentOwnerEmail: vi.fn(),
  getDefaultRecordingVisibility: vi.fn(),
  nanoid: vi.fn(),
  parseSpaceIds: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  stringifySpaceIds: vi.fn(),
  hasRequestVideoStorage: vi.fn(),
  downloadDirectVideo: vi.fn(),
  isCandidateDirectVideoUrl: vi.fn(),
  queueBuilderMediaCompression: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => mocks.defineAction(options),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mocks.writeAppStateForCurrentTab(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));
vi.mock("@agent-native/core/server", () => ({ buildDeepLink: vi.fn() }));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => mocks.and(...args),
  asc: (...args: unknown[]) => mocks.asc(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
  gte: (...args: unknown[]) => mocks.gte(...args),
  inArray: (...args: unknown[]) => mocks.inArray(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      sourceAppName: "recordings.sourceAppName",
      createdAt: "recordings.createdAt",
    },
    recordingTranscripts: {
      recordingId: "recording_transcripts.recordingId",
    },
  },
}));

vi.mock("../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: (...args: unknown[]) =>
    mocks.queueBuilderMediaCompression(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: (...args: unknown[]) =>
    mocks.getCurrentOwnerEmail(...args),
  getDefaultRecordingVisibility: (...args: unknown[]) =>
    mocks.getDefaultRecordingVisibility(...args),
  nanoid: (...args: unknown[]) => mocks.nanoid(...args),
  ownerEmailMatches: (...args: unknown[]) => mocks.ownerEmailMatches(...args),
  parseSpaceIds: (...args: unknown[]) => mocks.parseSpaceIds(...args),
  requireOrganizationAccess: (...args: unknown[]) =>
    mocks.requireOrganizationAccess(...args),
  stringifySpaceIds: (...args: unknown[]) => mocks.stringifySpaceIds(...args),
}));

vi.mock("../server/lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    ensureEnabledAt: (...args: unknown[]) => mocks.ensureEnabledAt(...args),
    enqueueOrConvergeFirstImport: (...args: unknown[]) =>
      mocks.enqueue(...args),
  },
}));

vi.mock("../server/lib/video-storage.js", () => ({
  hasRequestVideoStorage: (...args: unknown[]) =>
    mocks.hasRequestVideoStorage(...args),
}));

vi.mock("./lib/direct-video.js", () => ({
  downloadDirectVideo: (...args: unknown[]) =>
    mocks.downloadDirectVideo(...args),
  isCandidateDirectVideoUrl: (...args: unknown[]) =>
    mocks.isCandidateDirectVideoUrl(...args),
}));

vi.mock("./lib/loom-transcript.js", () => ({
  fetchLoomTranscript: vi.fn(),
  loomTranscriptUnavailableMessage: vi.fn(),
}));

vi.mock("./lib/loom-video.js", () => ({ downloadLoomVideo: vi.fn() }));

import importLoomRecording, {
  enqueueFirstImportEmailIfEligible,
} from "./import-loom-recording";

function createDb(firstReadyImportId: string | null) {
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.orderBy.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue(
    firstReadyImportId ? [{ id: firstReadyImportId }] : [],
  );
  return { select: mocks.select } as any;
}

describe("first imported recording transactional email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureEnabledAt.mockResolvedValue({
      enabledAt: "2026-07-01T00:00:00.000Z",
    });
    mocks.enqueue.mockResolvedValue({ created: true });
    mocks.ownerEmailMatches.mockReturnValue("owner-match");
    mocks.and.mockReturnValue("conditions");
    mocks.asc.mockImplementation((column) => ({ column, direction: "asc" }));
    mocks.eq.mockImplementation((column, value) => ({ column, value }));
    mocks.gte.mockImplementation((column, value) => ({ column, value }));
    mocks.inArray.mockImplementation((column, values) => ({ column, values }));
  });

  it("enqueues only when this recording is the first ready import after enablement", async () => {
    const db = createDb("recording-first");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-first",
        ownerEmail: "Owner@Example.com",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      db,
    );

    expect(mocks.eq).toHaveBeenCalledWith("recordings.status", "ready");
    expect(mocks.inArray).toHaveBeenCalledWith("recordings.sourceAppName", [
      "Loom",
      "Video link",
    ]);
    expect(mocks.gte).toHaveBeenCalledWith(
      "recordings.createdAt",
      "2026-07-01T00:00:00.000Z",
    );
    expect(mocks.orderBy).toHaveBeenCalledWith(
      { column: "recordings.createdAt", direction: "asc" },
      { column: "recordings.id", direction: "asc" },
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "Owner@Example.com",
      "recording-first",
      "Owner@Example.com",
    );
  });

  it("does not query or enqueue for a recording created before enablement", async () => {
    const db = createDb("recording-old");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-old",
        ownerEmail: "owner@example.com",
        createdAt: "2026-06-30T23:59:59.999Z",
      },
      db,
    );

    expect(mocks.ensureEnabledAt).toHaveBeenCalledOnce();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue later successful imports", async () => {
    const db = createDb("recording-first");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-later",
        ownerEmail: "owner@example.com",
        createdAt: "2026-07-03T00:00:00.000Z",
      },
      db,
    );

    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("preserves WebM format and filename for direct imports", async () => {
    const insertValues = vi.fn(async () => undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-webm");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/webm",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-webm.webm",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockResolvedValue({
      enabledAt: "2026-07-01T00:00:00.000Z",
    });
    mocks.limit.mockResolvedValue([{ id: "recording-webm" }]);

    await importLoomRecording.run({
      url: "https://media.example.com/source.webm",
    });

    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "recording-webm.webm",
        mimeType: "video/webm",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ videoFormat: "webm" }),
    );
  });

  it("completes a persisted import when transactional email enqueue fails", async () => {
    const insertValues = vi.fn(async () => undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-imported");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-imported.mp4",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await importLoomRecording.run({
      url: "https://media.example.com/source.mp4",
    });

    expect(result).toMatchObject({
      recordingId: "recording-imported",
      status: "ready",
    });
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(mocks.writeAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "recording",
      recordingId: "recording-imported",
    });
    expect(warn).toHaveBeenCalledWith(
      "[clips] First-import email enqueue failed",
      {
        recordingId: "recording-imported",
        error: "email store unavailable",
      },
    );
  });
});
