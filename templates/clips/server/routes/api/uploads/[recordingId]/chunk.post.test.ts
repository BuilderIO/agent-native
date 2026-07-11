import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const RECORDING_TOO_LARGE_REASON = `Recording exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB size limit. Please record a shorter clip.`;

const mockAppState = vi.hoisted(() => new Map<string, Record<string, any>>());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockGetHeader = vi.hoisted(() => vi.fn());
const mockReadRawBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetEventOwnerContext = vi.hoisted(() => vi.fn());
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockDeleteRecordingChunks = vi.hoisted(() => vi.fn());
const mockPruneStaleRecordingChunks = vi.hoisted(() => vi.fn());
const mockSumRecordingChunkBytes = vi.hoisted(() => vi.fn());
const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockSetResumableSession = vi.hoisted(() => vi.fn());
const mockRelayChunk = vi.hoisted(() => vi.fn());
const mockResolveResumableUploadProvider = vi.hoisted(() => vi.fn());
const mockIsStreamingUploadDisabled = vi.hoisted(() => vi.fn());
const mockAllowsSqlRecordingChunkScratch = vi.hoisted(() => vi.fn());
const mockShouldRejectVideoUploadWithoutStorage = vi.hoisted(() => vi.fn());
const mockFinalizeRun = vi.hoisted(() => vi.fn());
const mockUpdateSets = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockSelectRows = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(async () => mockSelectRows.rows),
    };
    return builder;
  }),
  update: vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      mockUpdateSets.push(values);
      return { where: vi.fn(async () => undefined) };
    }),
  })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  getHeader: (...args: unknown[]) => mockGetHeader(...args),
  readRawBody: (...args: unknown[]) => mockReadRawBody(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../../../../../actions/finalize-recording.js", () => ({
  default: { run: (...args: unknown[]) => mockFinalizeRun(...args) },
}));

vi.mock("../../../../db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      failureReason: "recordings.failureReason",
      videoUrl: "recordings.videoUrl",
      durationMs: "recordings.durationMs",
      width: "recordings.width",
      height: "recordings.height",
      hasAudio: "recordings.hasAudio",
      hasCamera: "recordings.hasCamera",
      uploadProgress: "recordings.uploadProgress",
      updatedAt: "recordings.updatedAt",
    },
  },
}));

vi.mock("../../../../lib/recording-upload-state.js", () => ({
  deleteRecordingChunks: (...args: unknown[]) =>
    mockDeleteRecordingChunks(...args),
  pruneStaleRecordingChunks: (...args: unknown[]) =>
    mockPruneStaleRecordingChunks(...args),
  sumRecordingChunkBytes: (...args: unknown[]) =>
    mockSumRecordingChunkBytes(...args),
}));

vi.mock("../../../../lib/recordings.js", () => ({
  getEventOwnerContext: (...args: unknown[]) =>
    mockGetEventOwnerContext(...args),
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
}));

vi.mock("../../../../lib/resumable-session.js", () => ({
  getResumableSession: (...args: unknown[]) => mockGetResumableSession(...args),
  setResumableSession: (...args: unknown[]) => mockSetResumableSession(...args),
}));

vi.mock("../../../../lib/resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: (...args: unknown[]) =>
    mockResolveResumableUploadProvider(...args),
}));

vi.mock("../../../../lib/streaming-upload-mode.js", () => ({
  isStreamingUploadDisabled: (...args: unknown[]) =>
    mockIsStreamingUploadDisabled(...args),
}));

vi.mock("../../../../lib/video-storage.js", () => ({
  allowsSqlRecordingChunkScratch: (...args: unknown[]) =>
    mockAllowsSqlRecordingChunkScratch(...args),
  shouldRejectVideoUploadWithoutStorage: (...args: unknown[]) =>
    mockShouldRejectVideoUploadWithoutStorage(...args),
  STORAGE_SETUP_REQUIRED_REASON: "Storage setup required",
}));

import handler from "./chunk.post";

const UPLOAD_KEY = "recording-upload-rec-1";
const CHUNK_PREFIX = "recording-chunks-rec-1-";

function chunkKeys(): string[] {
  return [...mockAppState.keys()].filter((key) => key.startsWith(CHUNK_PREFIX));
}

function setRequest(options: {
  query: Record<string, unknown>;
  body?: Uint8Array;
}) {
  mockGetQuery.mockReturnValue(options.query);
  mockReadRawBody.mockResolvedValue(options.body ?? new Uint8Array(0));
}

describe("/api/uploads/:recordingId/chunk route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.clear();
    mockUpdateSets.length = 0;
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        failureReason: null,
        ownerEmail: "owner@example.com",
        videoUrl: null,
      },
    ];
    mockGetRouterParam.mockReturnValue("rec-1");
    mockGetHeader.mockReturnValue(undefined);
    mockGetEventOwnerContext.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockGetResumableSession.mockResolvedValue(null);
    mockSetResumableSession.mockResolvedValue(undefined);
    mockIsStreamingUploadDisabled.mockReturnValue(false);
    mockShouldRejectVideoUploadWithoutStorage.mockResolvedValue(false);
    mockAllowsSqlRecordingChunkScratch.mockReturnValue(true);
    mockResolveResumableUploadProvider.mockResolvedValue({
      resumable: { relayChunk: mockRelayChunk },
    });
    mockRelayChunk.mockResolvedValue({ ok: true, status: 308 });
    mockFinalizeRun.mockResolvedValue({
      id: "rec-1",
      status: "ready",
      videoUrl: "/api/video/rec-1",
    });
    mockPruneStaleRecordingChunks.mockResolvedValue(0);
    // Faithful in-memory application_state: chunk writes land in the same
    // store that sumRecordingChunkBytes / deleteRecordingChunks operate on,
    // so byte accounting and sequencing come from the route's real logic.
    mockReadAppState.mockImplementation(
      async (key: string) => mockAppState.get(key) ?? null,
    );
    mockWriteAppState.mockImplementation(
      async (key: string, value: Record<string, any>) => {
        mockAppState.set(key, value);
      },
    );
    mockSumRecordingChunkBytes.mockImplementation(
      async (_ownerEmail: string, recordingId: string) => {
        let sum = 0;
        for (const [key, value] of mockAppState) {
          if (key.startsWith(`recording-chunks-${recordingId}-`)) {
            sum += Number(value.bytes) || 0;
          }
        }
        return sum;
      },
    );
    mockDeleteRecordingChunks.mockImplementation(
      async (_ownerEmail: string, recordingId: string) => {
        let deleted = 0;
        for (const key of [...mockAppState.keys()]) {
          if (key.startsWith(`recording-chunks-${recordingId}-`)) {
            mockAppState.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      },
    );
  });

  it("stores in-order chunks and advances upload progress state", async () => {
    setRequest({
      query: { index: "0", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: false,
      index: 0,
      bytes: 5,
    });

    expect(mockAppState.get(`${CHUNK_PREFIX}000000`)).toEqual(
      expect.objectContaining({
        recordingId: "rec-1",
        index: 0,
        bytes: 5,
        mimeType: "video/webm",
        data: Buffer.from([1, 2, 3, 4, 5]).toString("base64"),
      }),
    );
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        recordingId: "rec-1",
        status: "uploading",
        progress: 25,
        chunksReceived: 1,
        totalChunks: 4,
        bytesReceived: 5,
        maxBytes: MAX_UPLOAD_BYTES,
        mimeType: "video/webm",
      }),
    );

    setRequest({
      query: { index: "1", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([6, 7, 8, 9, 10]),
    });
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: false,
      index: 1,
      bytes: 5,
    });

    expect(chunkKeys().sort()).toEqual([
      `${CHUNK_PREFIX}000000`,
      `${CHUNK_PREFIX}000001`,
    ]);
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        status: "uploading",
        progress: 50,
        chunksReceived: 2,
        bytesReceived: 10,
      }),
    );
    expect(mockUpdateSets).toEqual([
      expect.objectContaining({ uploadProgress: 25 }),
      expect.objectContaining({ uploadProgress: 50 }),
    ]);
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("finalizes on the empty final sentinel and reports the finalize result", async () => {
    mockAppState.set(`${CHUNK_PREFIX}000000`, { bytes: 5 });
    mockAppState.set(`${CHUNK_PREFIX}000001`, { bytes: 5 });
    mockAppState.set(UPLOAD_KEY, {
      recordingId: "rec-1",
      status: "uploading",
      progress: 66,
      chunksReceived: 2,
      totalChunks: 3,
      bytesReceived: 10,
    });
    setRequest({
      query: {
        index: "2",
        total: "3",
        isFinal: "1",
        mimeType: "video/webm",
        durationMs: "1234",
        width: "1280",
        height: "720",
        hasAudio: "1",
        hasCamera: "0",
      },
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: true,
      waitingForStorage: false,
      id: "rec-1",
      status: "ready",
      videoUrl: "/api/video/rec-1",
    });

    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      durationMs: 1234,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasCamera: false,
      locallyTranscoded: undefined,
      mimeType: "video/webm",
    });
    // The empty sentinel must not be persisted as a zero-byte chunk.
    expect(chunkKeys().sort()).toEqual([
      `${CHUNK_PREFIX}000000`,
      `${CHUNK_PREFIX}000001`,
    ]);
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        status: "processing",
        progress: 100,
        chunksReceived: 3,
        totalChunks: 3,
        expectedDataChunks: 2,
        finalChunkIndex: 2,
        finalChunkBytes: 0,
        bytesReceived: 10,
      }),
    );
  });

  it("accepts out-of-order chunks under their own keys with monotonic progress", async () => {
    setRequest({
      query: { index: "2", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: false,
      index: 2,
      bytes: 5,
    });
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({ chunksReceived: 3, progress: 75 }),
    );

    // The earlier chunk arrives late: stored under its own key, and progress
    // never regresses below the high-water mark.
    setRequest({
      query: { index: "0", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([6, 7, 8, 9, 10]),
    });
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: false,
      index: 0,
      bytes: 5,
    });

    expect(chunkKeys().sort()).toEqual([
      `${CHUNK_PREFIX}000000`,
      `${CHUNK_PREFIX}000002`,
    ]);
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        chunksReceived: 3,
        progress: 75,
        bytesReceived: 10,
      }),
    );
  });

  it("treats a repeated chunk index as an idempotent overwrite without double-counting bytes", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      setRequest({
        query: { index: "1", total: "4", mimeType: "video/webm" },
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });
      await expect(handler({} as any)).resolves.toEqual({
        ok: true,
        finalized: false,
        index: 1,
        bytes: 5,
      });
    }

    expect(chunkKeys()).toEqual([`${CHUNK_PREFIX}000001`]);
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        chunksReceived: 2,
        progress: 50,
        bytesReceived: 5,
      }),
    );
  });

  it("rejects chunks for an already-aborted recording without recreating scratch chunks", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        failureReason: "Recording was cancelled.",
        ownerEmail: "owner@example.com",
      },
    ];
    setRequest({
      query: { index: "3", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: "Recording was cancelled.",
        maxBytes: MAX_UPLOAD_BYTES,
      }),
    );

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(chunkKeys()).toEqual([]);
    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("stops before persisting when an abort lands mid-request and clears scratch chunks", async () => {
    let uploadStateReads = 0;
    mockReadAppState.mockImplementation(async (key: string) => {
      if (key === UPLOAD_KEY) {
        uploadStateReads += 1;
        // First read (pre-write snapshot) sees a healthy upload; the re-check
        // just before the chunk write observes the concurrent /abort marker.
        return uploadStateReads >= 2
          ? {
              recordingId: "rec-1",
              status: "failed",
              failureReason: "Recording was cancelled.",
            }
          : null;
      }
      return mockAppState.get(key) ?? null;
    });
    setRequest({
      query: { index: "1", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: "Recording was cancelled.",
      }),
    );

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
    );
    expect(chunkKeys()).toEqual([]);
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("acks a retried final chunk after the recording is ready without rewriting state", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "ready",
        failureReason: null,
        ownerEmail: "owner@example.com",
      },
    ];
    setRequest({
      query: { index: "2", total: "3", isFinal: "1", mimeType: "video/webm" },
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: true,
    });

    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("returns 409 aborted when finalize reports the recording was cancelled", async () => {
    mockAppState.set(`${CHUNK_PREFIX}000000`, { bytes: 5 });
    mockFinalizeRun.mockResolvedValue({ status: "failed" });
    setRequest({
      query: { index: "1", total: "2", isFinal: "1", mimeType: "video/webm" },
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: false,
      finalized: false,
      aborted: true,
      status: "failed",
      error: "Recording was cancelled before it finished saving.",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
  });

  it("rejects a chunk above the per-chunk byte cap before any owner or db work", async () => {
    mockGetHeader.mockReturnValue(String(5 * 1024 * 1024));
    setRequest({
      query: { index: "0", total: "4", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3]),
    });

    await expect(handler({} as any)).resolves.toEqual({
      error: "Chunk too large",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 413);
    expect(mockGetEventOwnerContext).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("fails the recording when cumulative bytes exceed the upload ceiling", async () => {
    mockAppState.set(`${CHUNK_PREFIX}000000`, {
      recordingId: "rec-1",
      index: 0,
      bytes: MAX_UPLOAD_BYTES,
    });
    setRequest({
      query: { index: "1", total: "0", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: false,
      error: RECORDING_TOO_LARGE_REASON,
      bytesReceived: MAX_UPLOAD_BYTES + 5,
      maxBytes: MAX_UPLOAD_BYTES,
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 413);
    expect(mockUpdateSets).toEqual([
      expect.objectContaining({
        status: "failed",
        failureReason: RECORDING_TOO_LARGE_REASON,
      }),
    ]);
    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        status: "failed",
        failureReason: RECORDING_TOO_LARGE_REASON,
        bytesReceived: MAX_UPLOAD_BYTES + 5,
        maxBytes: MAX_UPLOAD_BYTES,
      }),
    );
    expect(chunkKeys()).toEqual([]);
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("relays a fresh resumable chunk to the provider and advances the committed offset", async () => {
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "sess-1",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 100,
      lastCommittedIndex: 2,
    });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    setRequest({
      query: {
        index: "3",
        total: "0",
        mimeType: "video/webm;codecs=vp9,opus",
      },
      body: bytes,
    });
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual({
        ok: true,
        finalized: false,
        index: 3,
        bytes: 5,
      });
    } finally {
      consoleLog.mockRestore();
    }

    expect(mockRelayChunk).toHaveBeenCalledWith(
      { sessionId: "sess-1", meta: { objectKey: "clips/rec-1.webm" } },
      "bytes 100-104/*",
      bytes,
      { mimeType: "video/webm" },
    );
    expect(mockSetResumableSession).toHaveBeenCalledWith("rec-1", {
      providerId: "s3",
      sessionId: "sess-1",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 105,
      lastCommittedIndex: 3,
    });
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("acks a replayed resumable chunk without re-uploading to the provider", async () => {
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "sess-1",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 100,
      lastCommittedIndex: 2,
    });
    setRequest({
      query: { index: "2", total: "0", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual({
        ok: true,
        finalized: false,
        index: 2,
        bytes: 5,
        duplicate: true,
      });
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }

    expect(mockRelayChunk).not.toHaveBeenCalled();
    expect(mockSetResumableSession).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });
});
