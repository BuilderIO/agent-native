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
  isNull: vi.fn(),
  defineAction: vi.fn((options: unknown) => options),
  writeAppState: vi.fn(),
  writeAppStateForCurrentTab: vi.fn(),
  uploadFile: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  getDb: vi.fn(),
  getCurrentAuthUserId: vi.fn(),
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
  dispatchPostFinalizeJob: vi.fn(),
  track: vi.fn(),
  recordingTrackingSource: vi.fn(
    (userId: string, authUserId?: string | null) => ({
      userId,
      ...(authUserId ? { authUserId } : {}),
    }),
  ),
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
  ssrfSafeFetch: (...args: unknown[]) => mocks.ssrfSafeFetch(...args),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));
vi.mock("@agent-native/core/server", () => ({ buildDeepLink: vi.fn() }));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => mocks.and(...args),
  asc: (...args: unknown[]) => mocks.asc(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
  gte: (...args: unknown[]) => mocks.gte(...args),
  inArray: (...args: unknown[]) => mocks.inArray(...args),
  isNull: (...args: unknown[]) => mocks.isNull(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      authUserId: "recordings.authUserId",
      uploadAttemptId: "recordings.uploadAttemptId",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      failureReason: "recordings.failureReason",
      sourceAppName: "recordings.sourceAppName",
      sourceWindowTitle: "recordings.sourceWindowTitle",
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
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mocks.dispatchPostFinalizeJob(...args),
}));
vi.mock("../server/lib/recording-failures.js", () => ({
  recordingTrackingSource: (...args: [string, string?]) =>
    mocks.recordingTrackingSource(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentAuthUserId: (...args: unknown[]) =>
    mocks.getCurrentAuthUserId(...args),
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
    mocks.getCurrentAuthUserId.mockReturnValue(null);
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
    mocks.isNull.mockImplementation((column) => ({ isNull: column }));
    mocks.dispatchPostFinalizeJob.mockResolvedValue(undefined);
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
    mocks.getCurrentAuthUserId.mockReturnValue("auth-user-webm");
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

    mocks.track.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });
    const result = await importLoomRecording.run({
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
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "recording-webm",
      kind: "thumbnail",
      requireAccepted: true,
    });
    expect(result).toMatchObject({ status: "ready" });
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "recording_ready",
      {
        app_name: "clips",
        template_name: "clips",
        output_id: "recording-webm",
        output_type: "clip",
        recording_attempt_id: "recording-webm",
        duration_s: 0,
        video_format: "webm",
        has_audio: true,
        has_camera: false,
        width: 0,
        height: 0,
      },
      { userId: "owner@example.com", authUserId: "auth-user-webm" },
    );
    expect(mocks.track.mock.invocationCallOrder[0]).toBeGreaterThan(
      insertValues.mock.invocationCallOrder[0],
    );
  });

  it("does not emit ready when a direct media import fails", async () => {
    const db = {
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
    mocks.nanoid.mockReturnValue("recording-failed");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockRejectedValue(new Error("download failed"));

    await expect(
      importLoomRecording.run({
        url: "https://media.example.com/source.mp4",
      }),
    ).rejects.toThrow("download failed");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("does not emit ready while a Loom import is still processing", async () => {
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
    mocks.nanoid.mockReturnValue("recording-processing");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.ssrfSafeFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "video",
        html: "<iframe></iframe>",
        title: "Loom video",
        duration: 5,
      }),
    });

    const result = await importLoomRecording.run({
      url: "https://www.loom.com/share/abcDEF_123456",
    });

    expect(result).toMatchObject({
      recordingId: "recording-processing",
      status: "processing",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing", videoUrl: null }),
    );
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("does not hide a failed direct-import thumbnail enqueue", async () => {
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
    mocks.nanoid.mockReturnValue("recording-no-thumb-job");
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
      url: "https://media.example.com/recording-no-thumb-job.mp4",
      provider: "builder",
    });
    mocks.dispatchPostFinalizeJob.mockRejectedValueOnce(
      new Error("thumbnail queue unavailable"),
    );

    await expect(
      importLoomRecording.run({
        url: "https://media.example.com/source.mp4",
      }),
    ).rejects.toThrow("thumbnail queue unavailable");
  });

  it("does not reuse an automatic thumbnail from an earlier direct import", async () => {
    const sourceUrl = "https://media.example.com/source.mp4";
    const updateValues = vi.fn();
    const updateReturning = vi
      .fn()
      .mockResolvedValueOnce([{ authUserId: "auth-user-retry" }])
      .mockResolvedValueOnce([]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const existing = {
      id: "recording-retry",
      organizationId: "org-1",
      ownerEmail: "owner@example.com",
      status: "uploading",
      videoUrl: null,
      failureReason:
        "Video storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage, then retry this import.",
      sourceAppName: "Video link",
      sourceWindowTitle: sourceUrl,
      thumbnailUrl: "https://media.example.com/old-thumbnail.jpg",
      editsJson: "{}",
      title: "Earlier import",
      titleSource: "upload",
      spaceIds: "[]",
      visibility: "private",
      folderId: null,
      authUserId: null,
      description: "",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const selectWhere = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: selectWhere })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({
        set: (values: unknown) => {
          updateValues(values);
          return { where: updateWhere };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.getCurrentAuthUserId.mockReturnValue("auth-user-retry");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
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
      url: "https://media.example.com/recording-retry.mp4",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );
    mocks.and.mockImplementation((...conditions) => conditions);

    const result = await importLoomRecording.run({
      url: sourceUrl,
      recordingId: "recording-retry",
    });
    const concurrentRetryResult = await importLoomRecording.run({
      url: sourceUrl,
      recordingId: "recording-retry",
    });

    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        videoUrl: "https://media.example.com/recording-retry.mp4",
        thumbnailUrl: null,
        authUserId: "auth-user-retry",
      }),
    );
    expect(updateWhere).toHaveBeenCalledWith(
      expect.arrayContaining([
        { column: "recordings.id", value: "recording-retry" },
        { column: "recordings.status", value: "uploading" },
        { isNull: "recordings.videoUrl" },
        {
          column: "recordings.failureReason",
          value:
            "Video storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage, then retry this import.",
        },
        { column: "recordings.sourceWindowTitle", value: sourceUrl },
      ]),
    );
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "recording_ready",
      expect.objectContaining({
        output_id: "recording-retry",
        recording_attempt_id: "recording-retry",
      }),
      { userId: "owner@example.com", authUserId: "auth-user-retry" },
    );
    expect(mocks.track.mock.invocationCallOrder[0]).toBeGreaterThan(
      updateReturning.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      recordingId: "recording-retry",
      thumbnailUrl: null,
    });
    expect(concurrentRetryResult).toMatchObject({
      recordingId: "recording-retry",
      thumbnailUrl: null,
    });
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(updateReturning).toHaveBeenCalledTimes(2);
    expect(mocks.track).toHaveBeenCalledTimes(1);
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
