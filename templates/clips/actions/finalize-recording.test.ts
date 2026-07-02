import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockDeleteAppState = vi.hoisted(() => vi.fn());
const mockUploadFile = vi.hoisted(() => vi.fn());
const mockListRecordingChunkKeys = vi.hoisted(() => vi.fn());
const mockRequestTranscriptRun = vi.hoisted(() => vi.fn());
const mockMarkRecordingSeekable = vi.hoisted(() => vi.fn());
const mockEnsureRecordingSeekable = vi.hoisted(() => vi.fn());
const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Array<Record<string, unknown>>>,
}));
const mockUpdateSets = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(async () => mockSelectRows.queue.shift() ?? []),
    };
    return builder;
  }),
  insert: vi.fn(() => ({
    values: mockInsertValues,
  })),
  update: vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      mockUpdateSets.push(values);
      return { where: vi.fn(async () => undefined) };
    }),
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

vi.mock("@agent-native/core/event-bus", () => ({
  emit: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProvider: vi.fn(),
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  captureRouteError: vi.fn(),
}));

vi.mock("@shared/upload-limits.js", () => ({
  MAX_UPLOAD_BYTES: 1024 * 1024,
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
  applyFaststart: (bytes: Uint8Array) => bytes,
  hasPlayableMp4Metadata: vi.fn(() => true),
}));

vi.mock("../server/lib/recording-upload-state.js", () => ({
  listRecordingChunkKeys: (...args: unknown[]) =>
    mockListRecordingChunkKeys(...args),
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
  deleteResumableSession: vi.fn(),
  getResumableSession: vi.fn(async () => null),
}));

vi.mock("../server/lib/streaming-upload-mode.js", () => ({
  isStreamingUploadDisabled: vi.fn(() => false),
}));

vi.mock("../server/lib/video-remux.js", () => ({
  remuxWebmToSeekable: vi.fn(),
}));

vi.mock("../server/lib/video-storage.js", () => ({
  requiresConfiguredVideoStorage: vi.fn(() => false),
  STORAGE_SETUP_REQUIRED_REASON: "Storage setup required",
}));

vi.mock("./lib/ensure-seekable-video.js", () => ({
  ensureRecordingSeekable: (...args: unknown[]) =>
    mockEnsureRecordingSeekable(...args),
  markRecordingSeekable: (...args: unknown[]) =>
    mockMarkRecordingSeekable(...args),
}));

vi.mock("./request-transcript.js", () => ({
  default: { run: (...args: unknown[]) => mockRequestTranscriptRun(...args) },
}));

import finalizeRecording from "./finalize-recording";

function existingRecording() {
  return {
    id: "rec-1",
    ownerEmail: "owner@example.com",
    title: "Test recording",
    status: "uploading",
    videoUrl: null,
    videoSizeBytes: 0,
    durationMs: 0,
    width: 0,
    height: 0,
    hasAudio: true,
    hasCamera: false,
  };
}

function seedBufferedRecording(): string[] {
  const chunkKeys = [
    "recording-chunk-owner@example.com-rec-1-0",
    "recording-chunk-owner@example.com-rec-1-1",
  ];
  const chunkData = new Map([
    [chunkKeys[0], Buffer.from("video-").toString("base64")],
    [chunkKeys[1], Buffer.from("bytes").toString("base64")],
  ]);
  mockSelectRows.queue = [[existingRecording()], []];
  mockListRecordingChunkKeys.mockResolvedValue(chunkKeys);
  mockReadAppState.mockImplementation(async (key: string) => {
    if (key === "recording-upload-rec-1") {
      return {
        durationMs: 1234,
        width: 1280,
        height: 720,
        hasAudio: true,
        hasCamera: false,
        mimeType: "video/mp4",
      };
    }
    if (key === "recording-compression-rec-1") return null;
    const data = chunkData.get(key);
    if (!data) return null;
    return { data, bytes: Buffer.from(data, "base64").byteLength };
  });
  return chunkKeys;
}

describe("finalize-recording media serve verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.queue = [];
    mockUpdateSets.length = 0;
    mockWriteAppState.mockResolvedValue(undefined);
    mockDeleteAppState.mockResolvedValue(undefined);
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.builder.io/api/v1/file/assets%2Forg%2Frec-1",
    });
    mockMarkRecordingSeekable.mockResolvedValue(undefined);
    mockEnsureRecordingSeekable.mockResolvedValue(undefined);
    mockRequestTranscriptRun.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not mark ready or purge chunks when uploaded media stays unservable", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 500 }));

    await expect(
      finalizeRecording.run({ id: "rec-1", mimeType: "video/mp4" }),
    ).rejects.toThrow(/stored-but-unservable/i);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "processing" }),
        expect.objectContaining({
          status: "failed",
          failureReason: expect.stringMatching(/stored-but-unservable/i),
        }),
      ]),
    );
    expect(mockUpdateSets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ready" })]),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "recording-upload-rec-1",
      expect.objectContaining({
        recordingId: "rec-1",
        status: "failed",
        mimeType: "video/mp4",
        durationMs: 1234,
        width: 1280,
        height: 720,
        hasAudio: true,
        hasCamera: false,
      }),
    );
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).not.toHaveBeenCalledWith(key);
    }
  });

  it("does not trust content-length without readable media bytes", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch).mockResolvedValue(
      new Response("", {
        status: 206,
        headers: { "content-length": "1024" },
      }),
    );

    await expect(
      finalizeRecording.run({ id: "rec-1", mimeType: "video/mp4" }),
    ).rejects.toThrow(/stored-but-unservable/i);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          failureReason: expect.stringMatching(/stored-but-unservable/i),
        }),
      ]),
    );
    expect(mockUpdateSets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ready" })]),
    );
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).not.toHaveBeenCalledWith(key);
    }
  });

  it("only reads one probe chunk when a server ignores the range request", async () => {
    const chunkKeys = seedBufferedRecording();
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        reads += 1;
        controller.enqueue(new TextEncoder().encode("ok"));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.mocked(fetch).mockResolvedValue(new Response(stream, { status: 200 }));

    const result = await finalizeRecording.run({
      id: "rec-1",
      mimeType: "video/mp4",
    });

    expect(result).toEqual(
      expect.objectContaining({ id: "rec-1", status: "ready" }),
    );
    expect(reads).toBe(1);
    expect(cancelled).toBe(true);
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("marks ready when media verification gets one 500 and then succeeds", async () => {
    const chunkKeys = seedBufferedRecording();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 206 }));

    const result = await finalizeRecording.run({
      id: "rec-1",
      mimeType: "video/mp4",
    });

    expect(result).toEqual(
      expect.objectContaining({ id: "rec-1", status: "ready" }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ready" })]),
    );
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });

  it("skips verification for app-relative dev media URLs", async () => {
    const chunkKeys = seedBufferedRecording();
    mockUploadFile.mockResolvedValue({ url: "/api/uploads/rec-1/blob" });

    const result = await finalizeRecording.run({
      id: "rec-1",
      mimeType: "video/mp4",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "rec-1",
        status: "ready",
        videoUrl: "/api/uploads/rec-1/blob",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    for (const key of chunkKeys) {
      expect(mockDeleteAppState).toHaveBeenCalledWith(key);
    }
  });
});
