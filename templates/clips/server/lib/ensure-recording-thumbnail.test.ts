import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  ownerEmailMatches: vi.fn(),
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  ne: vi.fn(),
  like: vi.fn(),
  or: vi.fn(),
  extractJpegFrame: vi.fn(),
  uploadFile: vi.fn(),
  deleteUploadedFile: vi.fn(),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  compareAndSetAppState: (...args: unknown[]) =>
    mocks.compareAndSetAppState(...args),
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteUploadedFile(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => mocks.and(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
  isNull: (...args: unknown[]) => mocks.isNull(...args),
  ne: (...args: unknown[]) => mocks.ne(...args),
  like: (...args: unknown[]) => mocks.like(...args),
  or: (...args: unknown[]) => mocks.or(...args),
}));
vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      thumbnailUrl: "recordings.thumbnailUrl",
      thumbnailStatus: "recordings.thumbnailStatus",
      thumbnailFailureReason: "recordings.thumbnailFailureReason",
      editsJson: "recordings.editsJson",
      animatedThumbnailUrl: "recordings.animatedThumbnailUrl",
      filmstripUrl: "recordings.filmstripUrl",
    },
  },
}));
vi.mock("./public-agent-context.js", () => ({
  loadRecordingMediaBytes: vi.fn(),
}));
vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => mocks.ownerEmailMatches(...args),
}));
vi.mock("./video-frame.js", () => ({
  extractJpegFrame: (...args: unknown[]) => mocks.extractJpegFrame(...args),
  VideoFrameExtractionError: class VideoFrameExtractionError extends Error {
    code = "NO_VIDEO";
  },
}));

import {
  ensureRecordingThumbnail,
  markThumbnailFailed,
} from "./ensure-recording-thumbnail";

function createDb(
  recording: Record<string, unknown>,
  updated: Array<Record<string, unknown>> = [
    { id: "rec-1", thumbnailUrl: "https://cdn.example.com/thumb.jpg" },
  ],
) {
  const selectWhere = vi.fn().mockResolvedValue([recording]);
  const selectResult = {
    limit: vi.fn(() => selectWhere()),
    then: (
      resolve: (value: unknown) => unknown,
      reject: (error: unknown) => unknown,
    ) => selectWhere().then(resolve, reject),
  };
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => selectResult) })),
  }));
  const updateReturning = vi.fn().mockResolvedValue(updated);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    select,
    update: vi.fn(() => ({ set: updateSet })),
  };
  return {
    db,
    select,
    selectWhere,
    update: db.update,
    updateSet,
    updateReturning,
  };
}

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    ownerEmail: "owner@example.com",
    status: "ready",
    videoUrl: "https://cdn.example.com/video.webm",
    videoFormat: "webm",
    thumbnailUrl: null,
    editsJson: "{}",
    sourceAppName: "Browser",
    ...overrides,
  };
}

describe("ensureRecordingThumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.and.mockReturnValue("conditions");
    mocks.eq.mockImplementation((column, value) => ({ column, value }));
    mocks.isNull.mockImplementation((column) => ({ column, isNull: true }));
    mocks.ne.mockImplementation((column, value) => ({ column, value }));
    mocks.like.mockImplementation((column, value) => ({ column, value }));
    mocks.or.mockReturnValue("or-conditions");
    mocks.ownerEmailMatches.mockReturnValue("owner-match");
    mocks.extractJpegFrame.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.uploadFile.mockResolvedValue({
      url: "https://cdn.example.com/thumb.jpg",
      provider: "builder",
    });
    mocks.deleteUploadedFile.mockResolvedValue(true);
    mocks.readAppState.mockResolvedValue(null);
    mocks.compareAndSetAppState.mockResolvedValue(true);
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  it("extracts and persists one thumbnail when the upload omitted it", async () => {
    const { db, update, updateSet } = createDb(recording());
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
      mimeType: "video/webm",
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "generated",
      changed: true,
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    });
    expect(mocks.extractJpegFrame).toHaveBeenCalledWith({
      mediaBytes: new Uint8Array([9, 9, 9]),
      mimeType: "video/webm",
      atMs: 350,
    });
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: new Uint8Array([1, 2, 3]),
        mimeType: "image/jpeg",
        ownerEmail: "owner@example.com",
        recordAsset: false,
      }),
    );
    expect(update).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailStatus: "generated",
        thumbnailFailureReason: null,
      }),
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.any(Object),
    );
  });

  it("marks a recording with no media as terminally unavailable", async () => {
    const { db, update, updateSet } = createDb(recording({ videoUrl: null }));
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "skipped-no-media",
      changed: false,
    });
    expect(update).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      thumbnailStatus: "none",
      thumbnailFailureReason: "skipped-no-media",
    });
  });

  it("marks a Loom-embed-backed recording as terminally unavailable", async () => {
    const { db, update, updateSet } = createDb(
      recording({ videoUrl: "https://www.loom.com/embed/abcdefgh12345678" }),
    );
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "skipped-loom-embed",
      changed: false,
    });
    expect(update).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      thumbnailStatus: "none",
      thumbnailFailureReason: "skipped-loom-embed",
    });
  });

  it("does not persist a status for a retryable failure", async () => {
    const { db, update } = createDb(recording());
    mocks.getDb.mockReturnValue(db);
    mocks.extractJpegFrame.mockRejectedValue(new Error("decode failed"));

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
    });

    expect(result.status).toBe("skipped-frame-extraction");
    expect(update).not.toHaveBeenCalled();
  });

  it("markThumbnailFailed persists a failed status with the given reason", async () => {
    const { db, update, updateSet } = createDb(recording());
    mocks.getDb.mockReturnValue(db);

    await markThumbnailFailed("rec-1", "retries exhausted");

    expect(update).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      thumbnailStatus: "failed",
      thumbnailFailureReason: "retries exhausted",
    });
  });

  it("does not regenerate an existing thumbnail", async () => {
    const { db, update } = createDb(
      recording({ thumbnailUrl: "https://cdn.example.com/existing.jpg" }),
    );
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "already-set",
      changed: false,
      thumbnailUrl: "https://cdn.example.com/existing.jpg",
    });
    expect(mocks.extractJpegFrame).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("persists a supplied thumbnail before the recording is ready", async () => {
    const { db, update } = createDb(
      recording({ status: "uploading", videoUrl: null }),
    );
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      thumbnailBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      thumbnailMimeType: "image/png",
    });

    expect(result.status).toBe("generated");
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        filename: "thumb-rec-1.png",
        mimeType: "image/png",
      }),
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it("defers to a thumbnail producer in another process", async () => {
    const { db } = createDb(recording());
    mocks.getDb.mockReturnValue(db);
    mocks.readAppState.mockResolvedValue({
      token: "other-process",
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      ensureRecordingThumbnail({
        recordingId: "rec-1",
        ownerEmail: "owner@example.com",
        mediaBytes: new Uint8Array([9, 9, 9]),
      }),
    ).resolves.toMatchObject({
      recordingId: "rec-1",
      status: "skipped-lease",
      changed: false,
    });
    expect(mocks.extractJpegFrame).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("single-flights concurrent thumbnail uploads for one recording", async () => {
    const { db } = createDb(recording());
    mocks.getDb.mockReturnValue(db);
    let releaseExtraction!: () => void;
    const extractionStarted = new Promise<void>((resolve) => {
      mocks.extractJpegFrame.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseExtraction = release;
        });
        return new Uint8Array([1, 2, 3]);
      });
    });

    const first = ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
    });
    await extractionStarted;
    const second = ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      thumbnailBytes: new Uint8Array([4, 5, 6]),
    });

    releaseExtraction();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        recordingId: "rec-1",
        status: "generated",
        changed: true,
        thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      },
      {
        recordingId: "rec-1",
        status: "generated",
        changed: true,
        thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      },
    ]);
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
  });

  it("cleans up the uploaded blob when another thumbnail wins the race", async () => {
    const { db, selectWhere } = createDb(recording(), []);
    const winner = recording({
      thumbnailUrl: "https://cdn.example.com/winner.jpg",
    });
    selectWhere
      .mockResolvedValueOnce([recording()])
      .mockResolvedValueOnce([winner]);
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "already-set",
      changed: false,
      thumbnailUrl: "https://cdn.example.com/winner.jpg",
    });
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      url: "https://cdn.example.com/thumb.jpg",
    });
  });

  it("cleans up a replaced generated asset only after checking references", async () => {
    const oldThumbnailUrl = "https://cdn.example.com/old-thumb.jpg";
    const { db, selectWhere } = createDb(
      recording({ thumbnailUrl: oldThumbnailUrl }),
      [
        {
          id: "rec-1",
          thumbnailUrl: "https://cdn.example.com/new-thumb.jpg",
        },
      ],
    );
    selectWhere.mockResolvedValueOnce([
      recording({ thumbnailUrl: oldThumbnailUrl }),
    ]);
    selectWhere.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(db);
    mocks.uploadFile.mockResolvedValue({
      url: "https://cdn.example.com/new-thumb.jpg",
      provider: "builder",
      id: "new-asset",
    });
    mocks.readAppState.mockImplementation(async (key: string) => {
      if (key === "recording-thumbnail-asset-rec-1") {
        return {
          url: oldThumbnailUrl,
          provider: "builder",
          id: "old-asset",
        };
      }
      return null;
    });

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      thumbnailBytes: new Uint8Array([1, 2, 3]),
      replaceNonEditorThumbnail: true,
    });

    expect(result).toMatchObject({
      status: "generated",
      thumbnailUrl: "https://cdn.example.com/new-thumb.jpg",
    });
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      url: oldThumbnailUrl,
      id: "old-asset",
    });
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "recording-thumbnail-asset-rec-1",
      {
        url: "https://cdn.example.com/new-thumb.jpg",
        provider: "builder",
        id: "new-asset",
      },
    );
  });

  it("cleans up the uploaded blob when thumbnail persistence fails", async () => {
    const { db, updateReturning, selectWhere } = createDb(recording());
    selectWhere
      .mockResolvedValueOnce([recording()])
      .mockResolvedValueOnce([recording()]);
    updateReturning.mockRejectedValueOnce(new Error("database unavailable"));
    mocks.getDb.mockReturnValue(db);

    await expect(
      ensureRecordingThumbnail({
        recordingId: "rec-1",
        ownerEmail: "owner@example.com",
        mediaBytes: new Uint8Array([9, 9, 9]),
      }),
    ).rejects.toThrow("database unavailable");
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      url: "https://cdn.example.com/thumb.jpg",
    });
  });
});
