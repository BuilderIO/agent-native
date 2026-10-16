import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Array<Record<string, unknown>>>,
}));
const mockReturning = vi.hoisted(() =>
  vi.fn(async () => [{ id: "updated-recording" }]),
);
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockReturning })),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockInsertOnConflict = vi.hoisted(() =>
  vi.fn(async (_: unknown) => undefined),
);
const mockInsertValues = vi.hoisted(() =>
  vi.fn((_: unknown) => ({ onConflictDoUpdate: mockInsertOnConflict })),
);
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
const mockHostedUpload = vi.hoisted(() => vi.fn());
const mockDeleteS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockResolveClipsVideoStorage = vi.hoisted(() => vi.fn());
const mockVerifyHostedClipMedia = vi.hoisted(() => vi.fn());
const mockConsumeHostedClipRecording = vi.hoisted(() => vi.fn());
const mockReleaseHostedClipRecording = vi.hoisted(() => vi.fn());
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

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mockWriteAppState,
}));
vi.mock("@agent-native/core/org", () => ({
  registerIdentityColumns: vi.fn(),
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
      loomImportClaimId: "loomImportClaimId",
      loomImportClaimedAt: "loomImportClaimedAt",
      uploadLeaseExpiresAt: "uploadLeaseExpiresAt",
      status: "status",
      updatedAt: "updatedAt",
      durationMs: "durationMs",
      sourceWindowTitle: "sourceWindowTitle",
      createdAt: "createdAt",
      storageMode: "storageMode",
      videoUrl: "videoUrl",
      videoSizeBytes: "videoSizeBytes",
      videoFormat: "videoFormat",
      failureCode: "failureCode",
    },
    recordingTranscripts: { recordingId: "recordingId" },
  },
}));
vi.mock("../../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: mockQueueBuilderMediaCompression,
}));
vi.mock("../../server/lib/s3-upload-provider.js", () => ({
  deleteS3ObjectByUrl: (...args: unknown[]) => mockDeleteS3ObjectByUrl(...args),
}));
vi.mock("../../server/lib/video-storage.js", () => ({
  resolveClipsVideoStorage: (...args: unknown[]) =>
    mockResolveClipsVideoStorage(...args),
  verifyHostedClipMedia: (...args: unknown[]) =>
    mockVerifyHostedClipMedia(...args),
  consumeHostedClipRecording: (...args: unknown[]) =>
    mockConsumeHostedClipRecording(...args),
  releaseHostedClipRecording: (...args: unknown[]) =>
    mockReleaseHostedClipRecording(...args),
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
vi.mock("./imported-transcript.js", () => ({
  notImportedTranscript: () => "not-imported-transcript",
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
    mockReturning.mockReset();
    mockReturning.mockResolvedValue([{ id: "updated-recording" }]);
    mockUpdateSet.mockClear();
    mockInsertValues.mockClear();
    mockInsertOnConflict.mockClear();
    mockWriteAppState.mockClear();
    mockUploadFile.mockReset();
    mockHostedUpload.mockReset();
    mockDeleteS3ObjectByUrl.mockReset();
    mockDeleteS3ObjectByUrl.mockResolvedValue(true);
    mockResolveClipsVideoStorage.mockReset();
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "own",
      provider: null,
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 100,
      maxClipDurationMs: 60_000,
    });
    mockVerifyHostedClipMedia.mockReset();
    mockVerifyHostedClipMedia.mockResolvedValue(3);
    mockConsumeHostedClipRecording.mockReset();
    mockConsumeHostedClipRecording.mockResolvedValue({ ok: true });
    mockReleaseHostedClipRecording.mockReset();
    mockReleaseHostedClipRecording.mockResolvedValue({ released: true });
    mockDownloadLoomVideo.mockReset();
    mockFetchLoomTranscript.mockReset();
    mockQueueBuilderMediaCompression.mockClear();
    mockEnsureRecordingThumbnail.mockClear();
    mockDispatchPostFinalizeJob.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("confirms its claim before starting Loom media work", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_start_lease",
        status: "processing",
        failureCode: null,
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_start_lease",
      },
    ]);
    mockReturning.mockResolvedValueOnce([]);

    const result = await runLoomImportJob({
      recordingId: "rec_start_lease",
      ownerEmail: "owner@example.com",
      claimId: "claim_start_lease",
    });

    expect(result).toEqual({
      status: "failed",
      failureReason: "The Loom import lease was lost before media was saved.",
    });
    expect(mockDownloadLoomVideo).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
    );
  });

  it("does not run or fail a claim after the recording was taken down", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_taken_down",
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: null,
        status: "failed",
        failureCode: "taken_down",
      },
    ]);

    await expect(
      runLoomImportJob({
        recordingId: "rec_taken_down",
        ownerEmail: "owner@example.com",
        claimId: "stale-claim",
      }),
    ).resolves.toEqual({
      status: "failed",
      failureReason: "This recording was removed from hosted Clips storage.",
    });

    expect(mockDownloadLoomVideo).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockHostedUpload).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("cleans an uploaded hosted object when takedown revokes the import claim", async () => {
    const videoUrl = "https://clips.example.com/clips/rec_takedown_race.mp4";
    mockSelectRows.queue.push([
      {
        id: "rec_takedown_race",
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_takedown_race",
        status: "processing",
        failureCode: null,
        storageMode: "hosted",
        videoUrl: null,
        videoSizeBytes: 0,
        videoFormat: "mp4",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { upload: mockHostedUpload },
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 3,
      maxClipDurationMs: 60_000,
    });
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
      sourceUrl: "https://cdn.loom.com/sessions/transcoded/x.mp4",
    });
    mockHostedUpload.mockResolvedValue({
      url: videoUrl,
      provider: "clips-hosted",
      id: "asset_takedown_race",
    });
    mockVerifyHostedClipMedia.mockResolvedValue(3);
    mockReturning
      .mockResolvedValueOnce([{ id: "rec_takedown_race" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockSelectRows.queue.push([
      {
        status: "failed",
        failureCode: "taken_down",
        loomImportClaimId: null,
        videoUrl: null,
      },
    ]);

    await expect(
      runLoomImportJob({
        recordingId: "rec_takedown_race",
        ownerEmail: "owner@example.com",
        claimId: "claim_takedown_race",
      }),
    ).resolves.toMatchObject({ status: "failed" });

    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(videoUrl, {
      storageMode: "hosted",
      recordingId: "rec_takedown_race",
    });
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
    );
    expect(mockReturning).toHaveBeenCalledTimes(4);
  });

  it("links an uploaded hosted object whose verification failed so the reaper can delete it and release the reservation", async () => {
    const videoUrl = "https://clips.example.com/clips/rec_mismatch.mp4";
    mockSelectRows.queue.push([
      {
        id: "rec_mismatch",
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_mismatch",
        status: "processing",
        failureCode: null,
        storageMode: "hosted",
        videoUrl: null,
        videoSizeBytes: 0,
        videoFormat: "mp4",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { upload: mockHostedUpload },
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 10,
      maxClipDurationMs: 60_000,
    });
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
      sourceUrl: "https://cdn.loom.com/sessions/transcoded/x.mp4",
    });
    mockHostedUpload.mockResolvedValue({
      url: videoUrl,
      provider: "clips-hosted",
      id: "asset_mismatch",
    });
    mockVerifyHostedClipMedia.mockResolvedValue(4);

    await expect(
      runLoomImportJob({
        recordingId: "rec_mismatch",
        ownerEmail: "owner@example.com",
        claimId: "claim_mismatch",
      }),
    ).resolves.toMatchObject({ status: "failed" });

    const linkOrder = mockUpdateSet.mock.calls.findIndex(
      ([values]) => (values as { videoUrl?: string }).videoUrl === videoUrl,
    );
    const failOrder = mockUpdateSet.mock.calls.findIndex(
      ([values]) => (values as { status?: string }).status === "failed",
    );
    expect(linkOrder).toBeGreaterThanOrEqual(0);
    expect(failOrder).toBeGreaterThan(linkOrder);
    // The distinct code keeps an in-place retry from reusing this object.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureCode: "media_verification_failed",
      }),
    );
    expect(mockConsumeHostedClipRecording).not.toHaveBeenCalled();
    expect(mockReleaseHostedClipRecording).not.toHaveBeenCalled();
  });

  it("keeps a transient verification read failure reusable instead of marking a mismatch", async () => {
    const videoUrl = "https://clips.example.com/clips/rec_transient.mp4";
    mockSelectRows.queue.push([
      {
        id: "rec_transient",
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_transient",
        status: "processing",
        failureCode: null,
        storageMode: "hosted",
        videoUrl: null,
        videoSizeBytes: 0,
        videoFormat: "mp4",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { upload: mockHostedUpload },
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 10,
      maxClipDurationMs: 60_000,
    });
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
      sourceUrl: "https://cdn.loom.com/sessions/transcoded/x.mp4",
    });
    mockHostedUpload.mockResolvedValue({
      url: videoUrl,
      provider: "clips-hosted",
      id: "asset_transient",
    });
    mockVerifyHostedClipMedia.mockRejectedValue(new Error("read timed out"));

    await expect(
      runLoomImportJob({
        recordingId: "rec_transient",
        ownerEmail: "owner@example.com",
        claimId: "claim_transient",
      }),
    ).resolves.toMatchObject({ status: "failed" });

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureCode: "loom_import_failed",
      }),
    );
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "media_verification_failed" }),
    );
  });

  it("renews its claim during media work and refuses ready after lease loss", async () => {
    vi.useFakeTimers();
    mockSelectRows.queue.push([
      {
        id: "rec_lease",
        status: "processing",
        failureCode: null,
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_lease",
      },
    ]);
    let finishDownload!: (media: {
      bytes: Uint8Array;
      mimeType: string;
      sizeBytes: number;
    }) => void;
    let finishUpload!: (upload: {
      url: string;
      provider: string;
      id: string;
    }) => void;
    mockDownloadLoomVideo.mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve;
      }),
    );
    mockUploadFile.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    );

    const job = runLoomImportJob({
      recordingId: "rec_lease",
      ownerEmail: "owner@example.com",
      claimId: "claim_lease",
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadLeaseExpiresAt: expect.any(String),
        loomImportClaimedAt: expect.any(String),
      }),
    );
    expect(JSON.stringify(mockUpdateWhere.mock.calls[0]?.[0])).toContain(
      "claim_lease",
    );

    mockReturning.mockResolvedValueOnce([]);
    finishDownload({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
    });
    await vi.waitFor(() => expect(mockUploadFile).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    finishUpload({
      url: "https://cdn.example.com/rec_lease.mp4",
      provider: "builder",
      id: "asset_lease",
    });

    await expect(job).resolves.toEqual({
      status: "failed",
      failureReason: "The Loom import lease was lost before media was saved.",
    });
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
    );
  });

  it("downloads, reuploads, and marks the recording ready", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_1",
        status: "processing",
        failureCode: null,
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

    const result = await runLoomImportJob({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
      claimId: "claim_1",
    });

    expect(result).toEqual({ status: "ready" });
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
    expect(mockInsertOnConflict).toHaveBeenCalledWith(
      expect.objectContaining({ setWhere: "not-imported-transcript" }),
    );
    expect(mockQueueBuilderMediaCompression).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec_1",
        videoUrl: "https://cdn.example.com/rec_1.mp4",
      }),
    );
  });

  it("pins hosted Loom imports, verifies and persists bytes before consuming", async () => {
    const videoUrl = "https://clips.example.com/rec_hosted.mp4";
    const hostedProvider = { upload: mockHostedUpload };
    mockSelectRows.queue.push([
      {
        id: "rec_hosted",
        status: "processing",
        failureCode: null,
        durationMs: 5_000,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_hosted",
        storageMode: "hosted",
        videoUrl: null,
        videoFormat: "mp4",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: hostedProvider,
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 3,
      maxClipDurationMs: 60_000,
    });
    mockDownloadLoomVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
      sourceUrl: "https://cdn.loom.com/sessions/transcoded/x.mp4",
    });
    mockHostedUpload.mockResolvedValue({
      url: videoUrl,
      provider: "clips-hosted",
      id: "asset_hosted",
    });
    mockVerifyHostedClipMedia.mockResolvedValue(3);
    mockConsumeHostedClipRecording.mockImplementation(async () => {
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ videoUrl, videoSizeBytes: 3 }),
      );
      return { ok: true };
    });
    mockSelectRows.queue.push([]);

    const result = await runLoomImportJob({
      recordingId: "rec_hosted",
      ownerEmail: "owner@example.com",
      claimId: "claim_hosted",
    });

    expect(result).toEqual({ status: "ready" });
    expect(mockResolveClipsVideoStorage).toHaveBeenCalledWith({
      intent: "existing",
      recordingId: "rec_hosted",
      email: "owner@example.com",
    });
    expect(mockDownloadLoomVideo).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 3 }),
    );
    expect(mockHostedUpload).toHaveBeenCalledOnce();
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockVerifyHostedClipMedia).toHaveBeenCalledWith({
      recordingId: "rec_hosted",
      videoUrl,
    });
    expect(mockConsumeHostedClipRecording).toHaveBeenCalledWith({
      recordingId: "rec_hosted",
      ownerEmail: "owner@example.com",
      actualBytes: 3,
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        storageMode: "hosted",
        status: "ready",
        videoUrl,
        videoSizeBytes: 3,
      }),
    );
  });

  it("reuses a verified hosted Loom object on retry without changing providers", async () => {
    const videoUrl = "https://clips.example.com/rec_retry.mp4";
    mockSelectRows.queue.push([
      {
        id: "rec_retry",
        status: "processing",
        failureCode: null,
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_retry",
        storageMode: "hosted",
        videoUrl,
        videoSizeBytes: 3,
        videoFormat: "mp4",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { upload: mockHostedUpload },
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 10,
      maxClipDurationMs: 60_000,
    });
    mockVerifyHostedClipMedia.mockResolvedValue(3);
    mockSelectRows.queue.push([]);

    const result = await runLoomImportJob({
      recordingId: "rec_retry",
      ownerEmail: "owner@example.com",
      claimId: "claim_retry",
    });

    expect(result).toEqual({ status: "ready" });
    expect(mockVerifyHostedClipMedia).toHaveBeenCalledWith({
      recordingId: "rec_retry",
      videoUrl,
    });
    expect(mockConsumeHostedClipRecording).toHaveBeenCalledOnce();
    expect(mockDownloadLoomVideo).not.toHaveBeenCalled();
    expect(mockHostedUpload).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        storageMode: "hosted",
        status: "ready",
        videoUrl,
      }),
    );
  });

  it("releases hosted allowance and clears hosted mode for Loom embed fallback", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_embed_hosted",
        status: "processing",
        failureCode: null,
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_embed_hosted",
        storageMode: "hosted",
        videoUrl: null,
        videoFormat: "mp4",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    mockResolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { upload: mockHostedUpload },
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 10,
      maxClipDurationMs: 60_000,
    });
    mockDownloadLoomVideo.mockRejectedValue(new LoomVideoUnavailableError());
    mockSelectRows.queue.push([]);

    const result = await runLoomImportJob({
      recordingId: "rec_embed_hosted",
      ownerEmail: "owner@example.com",
      claimId: "claim_embed_hosted",
    });

    expect(result).toEqual({ status: "ready" });
    expect(mockHostedUpload).not.toHaveBeenCalled();
    expect(mockReleaseHostedClipRecording).toHaveBeenCalledWith({
      recordingId: "rec_embed_hosted",
      ownerEmail: "owner@example.com",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        storageMode: null,
        videoUrl: "https://www.loom.com/embed/abcDEF_123456",
        status: "ready",
      }),
    );
    expect(mockConsumeHostedClipRecording).not.toHaveBeenCalled();
  });

  it("marks the recording failed instead of throwing when the download fails", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_2",
        status: "processing",
        failureCode: null,
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
  });

  it("keeps a playable Loom embed when MP4 export is unavailable", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_embed",
        status: "processing",
        failureCode: null,
        durationMs: 0,
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        loomImportClaimId: "claim_embed",
      },
    ]);
    mockDownloadLoomVideo.mockRejectedValue(new LoomVideoUnavailableError());
    mockFetchLoomTranscript.mockResolvedValue(null);

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
        status: "processing",
        failureCode: null,
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
  });

  it("keeps playable media ready when transcript persistence fails", async () => {
    mockSelectRows.queue.push([
      {
        id: "rec_4",
        status: "processing",
        failureCode: null,
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
    mockInsertOnConflict.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

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
  });
});
