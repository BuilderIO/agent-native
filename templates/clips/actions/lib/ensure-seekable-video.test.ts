import { beforeEach, describe, expect, it, vi } from "vitest";

const recording = vi.hoisted(() => ({
  id: "recording-example",
  status: "ready",
  videoUrl: "https://cdn.example.com/original.webm",
  videoFormat: "webm",
  storageMode: null as "own" | "hosted" | null,
  editsJson: null as string | null,
  sourceAppName: null,
}));
const repairedBytes = vi.hoisted(() => new Uint8Array([9, 8, 7, 6]));
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
      storageMode: "recordings.storageMode",
      editsJson: "recordings.editsJson",
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
}));

vi.mock("../../shared/loom.js", () => ({
  isLoomRecordingSource: vi.fn(() => false),
}));

import { ensureRecordingSeekable } from "./ensure-seekable-video";

describe("ensureRecordingSeekable timeline normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recording.storageMode = null;
    recording.editsJson = null;
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

  it("reads own storage through the signed reader too, and skips the plain fetch", async () => {
    recording.storageMode = "own";

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(result.status).toBe("already-optimized");
    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({
        recordingId: recording.id,
        storageMode: "own",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the plain fetch when own storage refuses the signed read", async () => {
    recording.storageMode = "own";
    const cancel = vi.fn(async () => undefined);
    mockFetchS3ObjectByUrl.mockResolvedValue({
      ok: false,
      status: 401,
      body: { cancel },
    } as unknown as Response);

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(cancel).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.status).toBe("already-optimized");
    expect(mockMakeSeekable).toHaveBeenCalledWith({
      mediaBytes: new Uint8Array([1, 2, 3]),
      videoFormat: "webm",
    });
  });

  it("falls back to the plain fetch when the signed read throws on own storage", async () => {
    recording.storageMode = "own";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchS3ObjectByUrl.mockRejectedValue(new Error("S3 request timed out"));

    try {
      const result = await ensureRecordingSeekable({
        recordingId: recording.id,
        ownerEmail: "owner@example.com",
      });

      expect(fetch).toHaveBeenCalledWith(
        recording.videoUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result.status).toBe("already-optimized");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("lets the signed reader accept a legacy unscoped key for the persisted media", async () => {
    recording.storageMode = "own";

    await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({ allowLegacyObjectKey: true }),
    );
  });

  it("treats a legacy row with no storage mode as own storage and falls back on a refusal", async () => {
    recording.storageMode = null;
    mockFetchS3ObjectByUrl.mockResolvedValue({
      ok: false,
      status: 401,
      body: { cancel: vi.fn(async () => undefined) },
    } as unknown as Response);

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({ storageMode: "own" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.status).toBe("already-optimized");
  });

  it("gives up on a signed body that stalls instead of hanging the job", async () => {
    vi.useFakeTimers();
    recording.storageMode = "own";
    const cancel = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel,
    });
    mockFetchS3ObjectByUrl.mockResolvedValue(
      new Response(stalled, {
        status: 200,
        headers: { "content-length": "3" },
      }),
    );

    try {
      const pending = ensureRecordingSeekable({
        recordingId: recording.id,
        ownerEmail: "owner@example.com",
      });
      await vi.advanceTimersByTimeAsync(60_001);
      const result = await pending;

      expect(cancel).toHaveBeenCalled();
      expect(result).toEqual({
        recordingId: recording.id,
        status: "skipped-fetch-failed",
        changed: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not allow a legacy key when the persisted media uses an external layout", async () => {
    recording.storageMode = "own";
    recording.editsJson = JSON.stringify({ mediaStorageLayout: "external" });

    await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    const [, options] = mockFetchS3ObjectByUrl.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).not.toHaveProperty("allowLegacyObjectKey");
  });

  it("never allows a legacy key on hosted storage", async () => {
    recording.storageMode = "hosted";

    await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    const [, options] = mockFetchS3ObjectByUrl.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({ storageMode: "hosted" });
    expect(options).not.toHaveProperty("allowLegacyObjectKey");
  });

  it("gives up on a body that trickles for too long even though it never stalls", async () => {
    vi.useFakeTimers();
    recording.storageMode = "own";
    let cancelled = false;
    const cancel = vi.fn(() => {
      cancelled = true;
    });
    const trickle = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (!cancelled) controller.enqueue(new Uint8Array([1]));
            resolve();
          }, 30_000);
        }),
      cancel,
    });
    mockFetchS3ObjectByUrl.mockResolvedValue(
      new Response(trickle, {
        status: 200,
        headers: { "content-length": "3" },
      }),
    );

    try {
      const started = Date.now();
      let settledAt = 0;
      const pending = ensureRecordingSeekable({
        recordingId: recording.id,
        ownerEmail: "owner@example.com",
      }).then((outcome) => {
        settledAt = Date.now();
        return outcome;
      });
      await vi.advanceTimersByTimeAsync(90_000);
      const result = await pending;

      expect(cancel).toHaveBeenCalled();
      // Two bytes in the first minute is far under the floor; the idle
      // timer alone would never have fired.
      expect(settledAt - started).toBeLessThanOrEqual(61_000);
      expect(result).toEqual({
        recordingId: recording.id,
        status: "skipped-fetch-failed",
        changed: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the plain fetch when the stored URL is not in the configured bucket", async () => {
    recording.storageMode = null;
    mockFetchS3ObjectByUrl.mockResolvedValue(null);

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(fetch).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.status).toBe("already-optimized");
  });

  it("does not fall back to an unsigned read of hosted storage", async () => {
    recording.storageMode = "hosted";
    mockFetchS3ObjectByUrl.mockResolvedValue({
      ok: false,
      status: 403,
      body: { cancel: vi.fn(async () => undefined) },
    } as unknown as Response);

    const result = await ensureRecordingSeekable({
      recordingId: recording.id,
      ownerEmail: "owner@example.com",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      recordingId: recording.id,
      status: "skipped-fetch-failed",
      changed: false,
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
});
