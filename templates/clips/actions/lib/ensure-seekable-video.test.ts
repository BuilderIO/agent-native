import { beforeEach, describe, expect, it, vi } from "vitest";

const recording = vi.hoisted(() => ({
  id: "recording-example",
  status: "ready",
  videoUrl: "https://cdn.example.com/original.webm",
  videoFormat: "webm",
  sourceAppName: null,
}));
const repairedBytes = vi.hoisted(() => new Uint8Array([9, 8, 7, 6]));
const mockUploadFile = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockMakeSeekable = vi.hoisted(() => vi.fn());
const mockNormalizeTimelineToMp4 = vi.hoisted(() => vi.fn());
const mockQueueCompression = vi.hoisted(() => vi.fn());
const mockDeleteRecordingMediaObjects = vi.hoisted(() => vi.fn());
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

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock("@shared/upload-limits.js", () => ({
  MAX_UPLOAD_BYTES: 1024 * 1024,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      videoFormat: "recordings.videoFormat",
      sourceAppName: "recordings.sourceAppName",
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
}));

vi.mock("../../server/lib/recordings.js", () => ({
  ownerEmailMatches: (column: unknown, email: string) => ({
    column,
    email,
    kind: "ownerEmailMatches",
  }),
}));

vi.mock("../../server/lib/video-remux.js", () => ({
  makeSeekable: (...args: unknown[]) => mockMakeSeekable(...args),
  normalizeTimelineToMp4: (...args: unknown[]) =>
    mockNormalizeTimelineToMp4(...args),
}));

vi.mock("../../shared/loom.js", () => ({
  isLoomRecordingSource: vi.fn(() => false),
}));

import { ensureRecordingSeekable } from "./ensure-seekable-video";

describe("ensureRecordingSeekable timeline normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockMakeSeekable.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      changed: false,
    });
    mockNormalizeTimelineToMp4.mockResolvedValue({
      bytes: repairedBytes,
      changed: true,
    });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/repaired.mp4",
      provider: "builder",
      id: "asset-example",
    });
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
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: repairedBytes,
        filename: expect.stringMatching(
          /^recording-example-timeline-normalized-\d+\.mp4$/,
        ),
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

    expect(mockUploadFile).not.toHaveBeenCalled();
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
    mockUploadFile.mockRejectedValue(new Error("upload failed"));

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
      normalizeTimeline: true,
    });

    expect(mockDb.update).not.toHaveBeenCalled();
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
});
