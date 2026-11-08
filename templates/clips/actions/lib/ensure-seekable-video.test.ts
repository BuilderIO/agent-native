import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recording = vi.hoisted(() => ({
  id: "recording-example",
  status: "ready",
  videoUrl: "https://cdn.example.com/original.webm",
  videoFormat: "webm",
  storageMode: null as "own" | "hosted" | null,
  sourceAppName: null,
  durationMs: 1000,
  width: 1280,
  height: 720,
  hasAudio: true,
}));
const repairedBytes = vi.hoisted(() => new Uint8Array([9, 8, 7, 6]));
const mockProbeMediaInfo = vi.hoisted(() => vi.fn());
const mockUploadRecordingMedia = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockMakeSeekable = vi.hoisted(() => vi.fn());
const mockNormalizeTimelineToMp4 = vi.hoisted(() => vi.fn());
const mockQueueCompression = vi.hoisted(() => vi.fn());
const mockDeleteRecordingMediaObjects = vi.hoisted(() => vi.fn());
const mockDeleteSupersededHostedMedia = vi.hoisted(() => vi.fn());
const mockFetchS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockClearSeekableRepairPending = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockReturning })),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => [recording]),
    })),
  })),
  update: vi.fn(() => ({ set: mockUpdateSet })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../../server/lib/upload-recording-media.js", () => ({
  uploadRecordingMedia: (...args: unknown[]) =>
    mockUploadRecordingMedia(...args),
}));
vi.mock("../../server/lib/s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: (...args: unknown[]) => mockFetchS3ObjectByUrl(...args),
}));

vi.mock("@shared/upload-limits.js", () => ({
  MAX_UPLOAD_BYTES: 1024 * 1024,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  })),
}));

/** The guarded value that fills a column only while it is still 0. */
const filled = (column: string, value: number) => ({
  sql: "coalesce(nullif(?, 0), ?)",
  values: [column, value],
});

vi.mock("../../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      videoFormat: "recordings.videoFormat",
      storageMode: "recordings.storageMode",
      sourceAppName: "recordings.sourceAppName",
      durationMs: "recordings.durationMs",
      width: "recordings.width",
      height: "recordings.height",
      hasAudio: "recordings.hasAudio",
    },
  },
}));

vi.mock("../../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: (...args: unknown[]) =>
    mockQueueCompression(...args),
}));

vi.mock("../../server/lib/recording-media-cleanup.js", () => ({
  deleteRecordingMediaObjects: (...args: unknown[]) =>
    mockDeleteRecordingMediaObjects(...args),
  deleteSupersededHostedMedia: (...args: unknown[]) =>
    mockDeleteSupersededHostedMedia(...args),
}));

vi.mock("../../server/lib/recordings.js", () => ({
  ownerEmailMatches: (column: unknown, email: string) => ({
    column,
    email,
    kind: "ownerEmailMatches",
  }),
}));

vi.mock("../../server/lib/seekable-media-state.js", () => ({
  clearSeekableRepairPending: (...args: unknown[]) =>
    mockClearSeekableRepairPending(...args),
}));

vi.mock("../../server/lib/video-remux.js", () => ({
  makeSeekable: (...args: unknown[]) => mockMakeSeekable(...args),
  normalizeTimelineToMp4: (...args: unknown[]) =>
    mockNormalizeTimelineToMp4(...args),
  probeMediaInfo: (...args: unknown[]) => mockProbeMediaInfo(...args),
}));

vi.mock("../../shared/loom.js", () => ({
  isLoomRecordingSource: vi.fn(() => false),
}));

import { ensureRecordingSeekable } from "./ensure-seekable-video";

describe("ensureRecordingSeekable timeline normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recording.storageMode = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-length": "3" },
          }),
        ),
      ),
    );
    mockReadAppState.mockResolvedValue(null);
    mockWriteAppState.mockResolvedValue(undefined);
    mockClearSeekableRepairPending.mockResolvedValue(undefined);
    mockProbeMediaInfo.mockResolvedValue({
      durationMs: 1000,
      width: 1280,
      height: 720,
      hasAudio: true,
    });
    mockMakeSeekable.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      changed: false,
    });
    mockNormalizeTimelineToMp4.mockResolvedValue({
      bytes: repairedBytes,
      changed: true,
    });
    mockUploadRecordingMedia.mockResolvedValue({
      url: "https://cdn.example.com/repaired.mp4",
      provider: "builder",
      id: "asset-example",
    });
    mockFetchS3ObjectByUrl.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "video/webm" },
      }),
    );
    mockReturning.mockResolvedValue([
      {
        id: recording.id,
        videoUrl: "https://cdn.example.com/repaired.mp4",
        videoFormat: "mp4",
      },
    ]);
    mockQueueCompression.mockResolvedValue({
      queued: false,
      reason: "locally-transcoded",
    });
    mockDeleteRecordingMediaObjects.mockResolvedValue({
      attempted: 1,
      deleted: 1,
      skipped: 0,
      errors: [],
    });
  });

  it("uploads a new MP4 and atomically repoints the owner recording", async () => {
    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockNormalizeTimelineToMp4).toHaveBeenCalledWith({
      mediaBytes: new Uint8Array([1, 2, 3]),
      videoFormat: "webm",
    });
    expect(mockMakeSeekable).not.toHaveBeenCalled();
    expect(mockUploadRecordingMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: recording.id,
        data: repairedBytes,
        filename: "recording-example.mp4",
        mimeType: "video/mp4",
        ownerEmail: "owner@example.com",
        stableUrl: true,
        recordAsset: false,
      }),
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://cdn.example.com/repaired.mp4",
        videoFormat: "mp4",
        videoSizeBytes: repairedBytes.byteLength,
      }),
    );
    expect(mockUpdateWhere).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          column: "recordings.videoUrl",
          value: recording.videoUrl,
        }),
      ]),
    );
    expect(mockQueueCompression).toHaveBeenCalledWith(
      expect.objectContaining({ locallyTranscoded: true }),
    );
    expect(result).toEqual({
      recordingId: recording.id,
      status: "optimized",
      changed: true,
      videoUrl: "https://cdn.example.com/repaired.mp4",
    });
    expect(mockClearSeekableRepairPending).toHaveBeenCalledWith(recording.id);
  });

  it("deletes the superseded hosted video once the repaired one is linked", async () => {
    recording.storageMode = "hosted";

    await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockDeleteSupersededHostedMedia).toHaveBeenCalledWith(
      recording.videoUrl,
      {
        recordingId: recording.id,
        replacementUrl: "https://cdn.example.com/repaired.mp4",
      },
    );
  });

  it("keeps the original video when the guarded update loses its race", async () => {
    recording.storageMode = "hosted";
    mockReturning.mockResolvedValue([]);

    await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockDeleteSupersededHostedMedia).not.toHaveBeenCalled();
  });

  it("reads a hosted source through the recording-scoped signed reader", async () => {
    recording.storageMode = "hosted";

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(result.status).toBe("already-optimized");
    expect(mockMakeSeekable).toHaveBeenCalledWith({
      mediaBytes: new Uint8Array([1, 2, 3]),
      videoFormat: "webm",
    });
    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({
        recordingId: recording.id,
        storageMode: "hosted",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves the original untouched when normalization cannot verify output", async () => {
    mockNormalizeTimelineToMp4.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      changed: false,
    });

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockUploadRecordingMedia).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        recordingId: recording.id,
        status: "skipped-normalize-failed",
        changed: false,
        videoUrl: recording.videoUrl,
      }),
    );
  });

  it("does not repoint the row when repaired media upload fails", async () => {
    mockUploadRecordingMedia.mockRejectedValue(new Error("upload failed"));

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockClearSeekableRepairPending).not.toHaveBeenCalled();
    expect(result).toEqual({
      recordingId: recording.id,
      status: "skipped-upload-failed",
      changed: false,
      videoUrl: recording.videoUrl,
    });
  });

  it("deletes the repaired upload when the guarded row update loses its race", async () => {
    mockReturning.mockResolvedValue([]);

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockDeleteRecordingMediaObjects).toHaveBeenCalledWith(
      {
        id: recording.id,
        storageMode: null,
        videoUrl: "https://cdn.example.com/repaired.mp4",
      },
      { protectedUrls: [recording.videoUrl] },
    );
    expect(mockQueueCompression).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        recordingId: recording.id,
        status: "skipped-upload-failed",
        changed: false,
        detail: "Recording changed while repaired media was uploading.",
      }),
    );
  });

  describe("measuring a streamed upload", () => {
    const given = {
      durationMs: 1000,
      width: 1280,
      height: 720,
      hasAudio: true,
    };
    const run = () =>
      ensureRecordingSeekable({
        recordingId: recording.id,
        ownerEmail: "owner@example.com",
      });

    afterEach(() => {
      Object.assign(recording, given);
    });

    it("saves what the upload left out and clears an audio claim the file doesn't back up", async () => {
      Object.assign(recording, {
        durationMs: 0,
        width: 0,
        height: 0,
        hasAudio: true,
      });
      mockProbeMediaInfo.mockResolvedValue({
        durationMs: 4200,
        width: 320,
        height: 240,
        hasAudio: false,
      });

      await run();

      // An exact match: `mediaUpdatedAt` stays, since transcripts are tied to it.
      expect(mockUpdateSet).toHaveBeenCalledWith({
        durationMs: filled("recordings.durationMs", 4200),
        width: filled("recordings.width", 320),
        height: filled("recordings.height", 240),
        hasAudio: false,
        updatedAt: expect.any(String),
      });
      expect(mockUpdateWhere).toHaveBeenCalledWith(
        expect.arrayContaining([
          { column: "recordings.videoUrl", value: recording.videoUrl },
        ]),
      );
      expect(mockWriteAppState).toHaveBeenCalledWith(
        "refresh-signal",
        expect.anything(),
      );
    });

    it("keeps the numbers the upload gave", async () => {
      Object.assign(recording, { durationMs: 9000, width: 0, height: 0 });
      mockProbeMediaInfo.mockResolvedValue({
        durationMs: 4200,
        width: 320,
        height: 240,
        hasAudio: true,
      });

      await run();

      expect(mockUpdateSet).toHaveBeenCalledWith({
        width: filled("recordings.width", 320),
        height: filled("recordings.height", 240),
        updatedAt: expect.any(String),
      });
    });

    it("writes nothing when the file agrees with the row", async () => {
      await run();

      expect(mockProbeMediaInfo).toHaveBeenCalled();
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("doesn't read a file with nothing left to learn from it", async () => {
      Object.assign(recording, { hasAudio: false });

      await run();

      expect(mockProbeMediaInfo).not.toHaveBeenCalled();
    });

    it("keeps an audio claim the probe couldn't settle", async () => {
      Object.assign(recording, { durationMs: 0 });
      mockProbeMediaInfo.mockResolvedValue({
        durationMs: 4200,
        width: null,
        height: null,
        hasAudio: null,
      });

      await run();

      expect(mockUpdateSet).toHaveBeenCalledWith({
        durationMs: filled("recordings.durationMs", 4200),
        updatedAt: expect.any(String),
      });
    });

    it("still finishes the job when the probe fails", async () => {
      Object.assign(recording, { durationMs: 0 });
      mockProbeMediaInfo.mockRejectedValue(new Error("ffmpeg went away"));

      const result = await run();

      expect(result.status).toBe("already-optimized");
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("writes what it measured in the swap when it replaces the media", async () => {
      Object.assign(recording, { durationMs: 0, width: 0, height: 0 });
      mockMakeSeekable.mockResolvedValue({
        bytes: repairedBytes,
        changed: true,
      });
      mockProbeMediaInfo.mockResolvedValue({
        durationMs: 4200,
        width: 320,
        height: 240,
        hasAudio: false,
      });
      mockReturning.mockResolvedValue([
        {
          id: recording.id,
          videoUrl: "https://cdn.example.com/repaired.mp4",
          videoFormat: "webm",
        },
      ]);

      const result = await run();

      expect(result.status).toBe("optimized");
      // Measured from the replacement, not the file it replaces.
      expect(mockProbeMediaInfo).toHaveBeenCalledWith(repairedBytes, "webm");
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: filled("recordings.durationMs", 4200),
          width: filled("recordings.width", 320),
          height: filled("recordings.height", 240),
          hasAudio: false,
          videoUrl: "https://cdn.example.com/repaired.mp4",
          mediaUpdatedAt: expect.any(String),
        }),
      );
    });

    it("saves nothing it measured when the replacement never uploads", async () => {
      Object.assign(recording, { durationMs: 0, width: 0, height: 0 });
      mockProbeMediaInfo.mockResolvedValue({
        durationMs: 4170,
        width: 320,
        height: 240,
        hasAudio: false,
      });
      mockUploadRecordingMedia.mockRejectedValue(new Error("upload failed"));

      const result = await ensureRecordingSeekable({
        recordingId: recording.id,
        ownerEmail: "owner@example.com",
        normalizeTimeline: true,
      });

      expect(result.status).toBe("skipped-upload-failed");
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
