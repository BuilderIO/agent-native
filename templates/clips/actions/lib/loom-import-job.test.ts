import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Array<Record<string, unknown>>>,
}));
const mockReturning = vi.hoisted(() =>
  vi.fn(async () => [
    {
      id: "rec_1",
      ownerEmail: "owner@example.com",
      authUserId: "auth-user-1",
      uploadAttemptId: "upload-attempt-1",
      durationMs: 5_000,
      videoFormat: "mp4",
      hasAudio: true,
      hasCamera: false,
      width: 1280,
      height: 720,
    },
  ]),
);
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockReturning })),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockInsertValues = vi.hoisted(() => vi.fn(async () => undefined));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => mockSelectRows.queue.shift() ?? []),
    })),
  })),
  update: vi.fn(() => ({ set: mockUpdateSet })),
  insert: vi.fn(() => ({ values: mockInsertValues })),
}));
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockUploadFile = vi.hoisted(() => vi.fn());
const mockDownloadLoomVideo = vi.hoisted(() => vi.fn());
const MockLoomVideoUnavailableError = vi.hoisted(
  () =>
    class extends Error {
      statusCode = 422;

      constructor() {
        super("Loom did not provide a downloadable MP4.");
        this.name = "LoomVideoUnavailableError";
      }
    },
);
const mockFetchLoomTranscript = vi.hoisted(() => vi.fn());
const mockQueueBuilderMediaCompression = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const mockEnsureRecordingThumbnail = vi.hoisted(() =>
  vi.fn(async () => ({
    recordingId: "rec_1",
    status: "generated" as const,
    changed: true,
    thumbnailUrl: "https://cdn.example.com/thumb.jpg",
  })),
);
const mockDispatchPostFinalizeJob = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const mockTrackRecordingFailure = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockRecordingTrackingSource = vi.hoisted(() =>
  vi.fn((userId: string, authUserId?: string | null) => ({
    userId,
    ...(authUserId ? { authUserId } : {}),
  })),
);

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mockWriteAppState,
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mockUploadFile,
}));
vi.mock("../../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "id",
      ownerEmail: "ownerEmail",
      status: "status",
      authUserId: "authUserId",
      uploadAttemptId: "uploadAttemptId",
      recordingPlatform: "recordingPlatform",
      durationMs: "durationMs",
      videoFormat: "videoFormat",
      hasAudio: "hasAudio",
      hasCamera: "hasCamera",
      width: "width",
      height: "height",
      loomImportClaimId: "loomImportClaimId",
    },
    recordingTranscripts: { recordingId: "recordingId" },
  },
}));
vi.mock("../../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: mockQueueBuilderMediaCompression,
}));
vi.mock("../../server/lib/ensure-recording-thumbnail.js", () => ({
  ensureRecordingThumbnail: (...args: unknown[]) =>
    mockEnsureRecordingThumbnail(...args),
  isRetryableRecordingThumbnailStatus: (status: string) =>
    [
      "skipped-media-fetch",
      "skipped-frame-extraction",
      "skipped-upload-failed",
      "skipped-race",
    ].includes(status),
}));
vi.mock("../../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mockDispatchPostFinalizeJob(...args),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: mockTrack }));
vi.mock("../../server/lib/recording-failures.js", () => ({
  recordingTrackingSource: (...args: [string, string?]) =>
    mockRecordingTrackingSource(...args),
  trackRecordingFailure: (...args: unknown[]) =>
    mockTrackRecordingFailure(...args),
}));
vi.mock("./loom-transcript.js", () => ({
  fetchLoomTranscript: mockFetchLoomTranscript,
  loomTranscriptUnavailableMessage: () => "Loom transcript unavailable",
}));
vi.mock("./loom-video.js", () => ({
  downloadLoomVideo: mockDownloadLoomVideo,
  LoomVideoUnavailableError: MockLoomVideoUnavailableError,
}));

import { runLoomImportJob } from "./loom-import-job";
import { LoomVideoUnavailableError } from "./loom-video";

describe("runLoomImportJob", () => {
  beforeEach(() => {
    mockSelectRows.queue = [];
    mockUpdateWhere.mockClear();
    mockReturning.mockClear();
    mockUpdateSet.mockClear();
    mockInsertValues.mockClear();
    mockWriteAppState.mockClear();
    mockUploadFile.mockReset();
    mockDownloadLoomVideo.mockReset();
    mockFetchLoomTranscript.mockReset();
    mockQueueBuilderMediaCompression.mockClear();
    mockEnsureRecordingThumbnail.mockClear();
    mockDispatchPostFinalizeJob.mockClear();
    mockTrackRecordingFailure.mockClear();
    mockTrack.mockReset();
    mockRecordingTrackingSource.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("emits media readiness once before optional transcript work", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_1",
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_1",
      },
    ]);
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
      sourceUrl: "https://cdn.loom.com/sessions/transcoded/x.mp4",
    });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/rec_1.mp4",
      provider: "builder",
      id: "asset_1",
    });
    mockFetchLoomTranscript.mockResolvedValue(null);
    mockSelectRows.queue.push([]); // no existing transcript row
    mockTrack.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });

    const result = await runLoomImportJob({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
      claimId: "claim_1",
    });

    expect(result).toEqual({ status: "ready" });
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(
      "recording_ready",
      {
        app_name: "clips",
        template_name: "clips",
        output_id: "rec_1",
        output_type: "clip",
        recording_attempt_id: "rec_1",
        upload_attempt_id: "upload-attempt-1",
        duration_s: 5,
        video_format: "mp4",
        has_audio: true,
        has_camera: false,
        width: 1280,
        height: 720,
      },
      { userId: "owner@example.com", authUserId: "auth-user-1" },
    );
    expect(mockTrack.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockReturning.mock.invocationCallOrder[0],
    );
    expect(mockDownloadLoomVideo).toHaveBeenCalledWith({
      loomId: "abcDEF_123456",
      shareUrl: "https://www.loom.com/share/abcDEF_123456",
      expectedDurationMs: 5_000,
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        videoUrl: "https://cdn.example.com/rec_1.mp4",
        failureReason: null,
      }),
    );
    expect(mockQueueBuilderMediaCompression).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec_1",
        videoUrl: "https://cdn.example.com/rec_1.mp4",
      }),
    );
  });

  it("marks the recording failed instead of throwing when the download fails", async () => {
    mockReturning.mockResolvedValueOnce([
      {
        id: "rec_2",
        ownerEmail: "owner@example.com",
        authUserId: "auth-user-2",
        uploadAttemptId: "upload-attempt-2",
        recordingPlatform: "desktop",
      },
    ]);
    mockSelectRows.queue.push([
      {
        id: "rec_2",
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_2",
      },
    ]);
    mockDownloadLoomVideo.mockRejectedValue(
      new Error("Loom video download failed (404 Not Found)."),
    );

    const result = await runLoomImportJob({
      recordingId: "rec_2",
      ownerEmail: "owner@example.com",
      claimId: "claim_2",
    });

    expect(result).toEqual({
      status: "failed",
      failureReason: "Loom video download failed (404 Not Found).",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureReason: "Loom video download failed (404 Not Found).",
      }),
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockTrackRecordingFailure).toHaveBeenCalledWith({
      recordingId: "rec_2",
      userId: "owner@example.com",
      authUserId: "auth-user-2",
      uploadAttemptId: "upload-attempt-2",
      platform: "desktop",
      failureCode: "loom_import_failed",
    });
  });

  it("does not invent canonical identity for a legacy Loom row", async () => {
    mockReturning.mockResolvedValueOnce([
      {
        id: "rec_unknown",
        ownerEmail: "owner@example.com",
        authUserId: null,
        uploadAttemptId: null,
        recordingPlatform: null,
      },
    ]);
    mockSelectRows.queue.push([
      {
        id: "rec_unknown",
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_unknown",
      },
    ]);
    mockDownloadLoomVideo.mockRejectedValue(new Error("download failed"));

    await runLoomImportJob({
      recordingId: "rec_unknown",
      ownerEmail: "owner@example.com",
      claimId: "claim_unknown",
    });

    expect(mockTrackRecordingFailure).toHaveBeenCalledTimes(1);
    expect(mockTrackRecordingFailure.mock.calls[0][0]).toEqual({
      recordingId: "rec_unknown",
      userId: "owner@example.com",
      authUserId: null,
      uploadAttemptId: null,
      platform: "import",
      failureCode: "loom_import_failed",
    });
  });

  it("keeps a playable Loom embed when MP4 export is unavailable", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_embed",
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_embed",
      },
    ]);
    mockDownloadLoomVideo.mockRejectedValue(new LoomVideoUnavailableError());
    mockFetchLoomTranscript.mockResolvedValue(null);
    mockSelectRows.queue.push([]);

    const result = await runLoomImportJob({
      recordingId: "rec_embed",
      ownerEmail: "owner@example.com",
      claimId: "claim_embed",
    });

    expect(result).toEqual({ status: "ready" });
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockQueueBuilderMediaCompression).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        videoUrl: "https://www.loom.com/embed/abcDEF_123456",
        videoSizeBytes: 0,
        failureReason: null,
      }),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "recording-upload-rec_embed",
      expect.objectContaining({
        status: "ready",
        videoUrl: "https://www.loom.com/embed/abcDEF_123456",
      }),
    );
  });

  it("marks the recording failed instead of throwing when upload fails", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_3",
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_3",
      },
    ]);
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: "video/mp4",
      sizeBytes: 1,
    });
    mockUploadFile.mockRejectedValue(new Error("storage unavailable"));

    const result = await runLoomImportJob({
      recordingId: "rec_3",
      ownerEmail: "owner@example.com",
      claimId: "claim_3",
    });

    expect(result).toEqual({
      status: "failed",
      failureReason: "storage unavailable",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureReason: "storage unavailable",
      }),
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("keeps playable media ready when transcript persistence fails", async () => {
    mockReturning.mockResolvedValueOnce([
      {
        id: "rec_4",
        ownerEmail: "owner@example.com",
        authUserId: "auth-user-4",
        uploadAttemptId: "upload-attempt-4",
        durationMs: 0,
        videoFormat: "mp4",
        hasAudio: true,
        hasCamera: false,
        width: 0,
        height: 0,
      },
    ]);
    mockSelectRows.queue.push([
      {
        id: "rec_4",
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_4",
      },
    ]);
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: "video/mp4",
      sizeBytes: 1,
    });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/rec_4.mp4",
      provider: "builder",
      id: "asset_4",
    });
    mockFetchLoomTranscript.mockResolvedValue(null);
    mockSelectRows.queue.push([]);
    mockInsertValues.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await runLoomImportJob({
      recordingId: "rec_4",
      ownerEmail: "owner@example.com",
      claimId: "claim_4",
    });

    expect(result).toEqual({ status: "ready" });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        videoUrl: "https://cdn.example.com/rec_4.mp4",
      }),
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(
      "recording_ready",
      expect.objectContaining({
        output_id: "rec_4",
        recording_attempt_id: "rec_4",
      }),
      { userId: "owner@example.com", authUserId: "auth-user-4" },
    );
    expect(mockTrack.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchLoomTranscript.mock.invocationCallOrder[0],
    );
  });
});
