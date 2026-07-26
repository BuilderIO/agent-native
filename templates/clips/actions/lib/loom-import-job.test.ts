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
const mockFetchLoomTranscript = vi.hoisted(() => vi.fn());
const mockQueueBuilderMediaCompression = vi.hoisted(() =>
  vi.fn(async () => undefined),
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
      loomImportClaimId: "loomImportClaimId",
    },
    recordingTranscripts: { recordingId: "recordingId" },
  },
}));
vi.mock("../../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: mockQueueBuilderMediaCompression,
}));
vi.mock("./loom-transcript.js", () => ({
  fetchLoomTranscript: mockFetchLoomTranscript,
  loomTranscriptUnavailableMessage: () => "Loom transcript unavailable",
}));
vi.mock("./loom-video.js", () => ({
  downloadLoomVideo: mockDownloadLoomVideo,
}));

import { runLoomImportJob } from "./loom-import-job";

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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("downloads, reuploads, and marks the recording ready", async () => {
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

    const result = await runLoomImportJob({
      recordingId: "rec_1",
      ownerEmail: "owner@example.com",
      claimId: "claim_1",
    });

    expect(result).toEqual({ status: "ready" });
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
  });

  it("keeps playable media ready when transcript persistence fails", async () => {
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
  });
});
