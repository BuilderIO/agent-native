import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  ownerEmailMatches: vi.fn(),
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  like: vi.fn(),
  or: vi.fn(),
  extractJpegFrame: vi.fn(),
  uploadFile: vi.fn(),
  writeAppState: vi.fn(),
  deleteRecordingMediaObjects: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => mocks.and(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
  isNull: (...args: unknown[]) => mocks.isNull(...args),
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
      editsJson: "recordings.editsJson",
    },
  },
}));
vi.mock("./recording-media-cleanup.js", () => ({
  deleteRecordingMediaObjects: (...args: unknown[]) =>
    mocks.deleteRecordingMediaObjects(...args),
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

import { ensureRecordingThumbnail } from "./ensure-recording-thumbnail";

function createDb(
  recording: Record<string, unknown>,
  updated: Array<Record<string, unknown>> = [
    { id: "rec-1", thumbnailUrl: "https://cdn.example.com/thumb.jpg" },
  ],
  references: Array<Record<string, unknown>> = [],
) {
  const selectWhere = vi.fn().mockResolvedValue([recording]);
  const referenceResults = vi.fn().mockResolvedValue(references);
  const select = vi.fn((selection?: unknown) => {
    if (!selection) {
      return { from: vi.fn(() => ({ where: selectWhere })) };
    }
    return {
      from: vi.fn(() => ({
        where: referenceResults,
      })),
    };
  });
  const updateReturning = vi.fn().mockResolvedValue(updated);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    select,
    update: vi.fn(() => ({ set: updateSet })),
  };
  return { db, select, selectWhere, update: db.update, updateSet };
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
    mocks.like.mockImplementation((column, value) => ({ column, value }));
    mocks.or.mockReturnValue("or-conditions");
    mocks.ownerEmailMatches.mockReturnValue("owner-match");
    mocks.extractJpegFrame.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.uploadFile.mockResolvedValue({
      url: "https://cdn.example.com/thumb.jpg",
      provider: "builder",
    });
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.deleteRecordingMediaObjects.mockResolvedValue(undefined);
  });

  it("extracts and persists one thumbnail when the upload omitted it", async () => {
    const { db, update } = createDb(recording());
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
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.any(Object),
    );
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

  it("cleans an unreferenced thumbnail when replacing it", async () => {
    const oldThumbnailUrl = "https://cdn.example.com/old.jpg";
    const { db } = createDb(recording({ thumbnailUrl: oldThumbnailUrl }), [
      { id: "rec-1", thumbnailUrl: "https://cdn.example.com/thumb.jpg" },
    ]);
    mocks.getDb.mockReturnValue(db);

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
      replaceNonEditorThumbnail: true,
    });

    expect(result.status).toBe("generated");
    expect(mocks.deleteRecordingMediaObjects).toHaveBeenCalledWith({
      id: "rec-1",
      thumbnailUrl: oldThumbnailUrl,
    });
  });

  it("keeps a superseded thumbnail that another recording still references", async () => {
    const oldThumbnailUrl = "https://cdn.example.com/shared.jpg";
    const { db } = createDb(
      recording({ thumbnailUrl: oldThumbnailUrl }),
      [{ id: "rec-1", thumbnailUrl: "https://cdn.example.com/thumb.jpg" }],
      [{ id: "other-recording", thumbnailUrl: oldThumbnailUrl }],
    );
    mocks.getDb.mockReturnValue(db);

    await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
      replaceNonEditorThumbnail: true,
    });

    expect(mocks.deleteRecordingMediaObjects).not.toHaveBeenCalled();
  });

  it("keeps a thumbnail retained by an editor URL selection", async () => {
    const oldThumbnailUrl = "https://cdn.example.com/editor.jpg";
    const editsJson = JSON.stringify({
      thumbnail: { kind: "url", value: oldThumbnailUrl },
    });
    const { db } = createDb(
      recording({ thumbnailUrl: null, editsJson }),
      [{ id: "rec-1", thumbnailUrl: "https://cdn.example.com/thumb.jpg" }],
      [{ id: "rec-1", editsJson }],
    );
    mocks.getDb.mockReturnValue(db);

    await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      mediaBytes: new Uint8Array([9, 9, 9]),
      previousThumbnailUrl: oldThumbnailUrl,
    });

    expect(mocks.deleteRecordingMediaObjects).not.toHaveBeenCalled();
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
});
