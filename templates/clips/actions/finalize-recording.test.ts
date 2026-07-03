import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  existingRecording: {
    id: "rec_1",
    status: "uploading",
    videoUrl: null,
    videoSizeBytes: 0,
    durationMs: 0,
    width: 0,
    height: 0,
    hasAudio: true,
    hasCamera: false,
    title: "Test recording",
  },
  uploadState: null as Record<string, unknown> | null,
  chunkRows: [] as Array<{ key: string }>,
}));

const mockUploadFile = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockDeleteAppState = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn(async () => undefined));
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => [mockState.existingRecording]),
    })),
  })),
  update: vi.fn(() => ({
    set: mockUpdateSet,
  })),
  insert: vi.fn(() => ({
    values: vi.fn(async () => undefined),
  })),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
  deleteAppState: (...args: unknown[]) => mockDeleteAppState(...args),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mockDbExecute }),
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/event-bus", () => ({
  emit: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProvider: vi.fn(() => null),
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  captureRouteError: vi.fn(),
}));

vi.mock("@shared/upload-limits.js", () => ({
  MAX_UPLOAD_BYTES: 1024 * 1024 * 1024,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
    },
  },
}));

vi.mock("../server/lib/debug.js", () => ({
  debugLog: vi.fn(),
}));

vi.mock("../server/lib/faststart.js", () => ({
  applyFaststart: vi.fn((bytes: Uint8Array) => bytes),
  hasPlayableMp4Metadata: vi.fn(() => true),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(() => "owner@example.com"),
  ownerEmailMatches: (column: unknown, email: string) => ({
    column,
    email,
    kind: "ownerEmailMatches",
  }),
}));

vi.mock("../server/lib/resumable-session.js", () => ({
  deleteResumableSession: vi.fn(async () => undefined),
  getResumableSession: vi.fn(async () => null),
}));

vi.mock("../server/lib/streaming-upload-mode.js", () => ({
  isStreamingUploadDisabled: vi.fn(() => false),
}));

vi.mock("../server/lib/video-remux.js", () => ({
  remuxWebmToSeekable: vi.fn(async (bytes: Uint8Array) => ({
    changed: false,
    bytes,
  })),
}));

vi.mock("../server/lib/video-storage.js", () => ({
  requiresConfiguredVideoStorage: vi.fn(() => false),
  STORAGE_SETUP_REQUIRED_REASON: "Storage required",
}));

vi.mock("./lib/ensure-seekable-video.js", () => ({
  ensureRecordingSeekable: vi.fn(),
  markRecordingSeekable: vi.fn(),
}));

vi.mock("./request-transcript.js", () => ({
  default: { run: vi.fn() },
}));

import finalizeRecording from "./finalize-recording";

describe("finalize-recording chunk completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.uploadState = {
      expectedDataChunks: 3,
      mimeType: "video/webm",
      durationMs: 60_000,
    };
    mockState.chunkRows = [];
    mockReadAppState.mockImplementation(async (key: string) => {
      if (key === "recording-upload-rec_1") return mockState.uploadState;
      return null;
    });
    mockDbExecute.mockImplementation(async () => ({
      rows: mockState.chunkRows,
      rowsAffected: 0,
    }));
  });

  it("fails before upload when persisted chunk indices have a gap", async () => {
    mockState.chunkRows = [
      { key: "recording-chunks-rec_1-000000" },
      { key: "recording-chunks-rec_1-000002" },
    ];

    await expect(finalizeRecording.run({ id: "rec_1" })).rejects.toThrow(
      "missing chunk 1",
    );

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureReason: expect.stringContaining("missing chunk 1"),
      }),
    );
  });

  it("fails before upload when final metadata expects more chunks", async () => {
    mockState.chunkRows = [
      { key: "recording-chunks-rec_1-000000" },
      { key: "recording-chunks-rec_1-000001" },
    ];

    await expect(finalizeRecording.run({ id: "rec_1" })).rejects.toThrow(
      "2 of 3 chunks received",
    );

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureReason: expect.stringContaining("2 of 3 chunks received"),
      }),
    );
  });
});
