import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const RECORDING_TOO_LARGE_REASON = `Recording exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB size limit. Please record a shorter clip.`;

const mockAppState = vi.hoisted(() => new Map<string, Record<string, any>>());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockIsFeatureFlagEnabled = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockGetHeader = vi.hoisted(() => vi.fn());
const mockReadRawBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetEventOwnerContext = vi.hoisted(() => vi.fn());
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockDeleteRecordingChunks = vi.hoisted(() => vi.fn());
const mockRenewUploadLease = vi.hoisted(() => vi.fn());
const mockSumRecordingChunkBytes = vi.hoisted(() => vi.fn());
const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockDeleteResumableSession = vi.hoisted(() => vi.fn());
const mockSetResumableSession = vi.hoisted(() => vi.fn());
const mockRelayChunk = vi.hoisted(() => vi.fn());
const mockAbortSession = vi.hoisted(() => vi.fn());
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

vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: (...args: unknown[]) =>
    mockIsFeatureFlagEnabled(...args),
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
      videoSizeBytes: "recordings.videoSizeBytes",
      durationMs: "recordings.durationMs",
      width: "recordings.width",
      height: "recordings.height",
      hasAudio: "recordings.hasAudio",
      hasCamera: "recordings.hasCamera",
      uploadProgress: "recordings.uploadProgress",
      uploadGenerationId: "recordings.uploadGenerationId",
      updatedAt: "recordings.updatedAt",
    },
  },
}));

vi.mock("../../../../lib/recording-upload-state.js", () => ({
  deleteRecordingChunks: (...args: unknown[]) =>
    mockDeleteRecordingChunks(...args),
  sumRecordingChunkBytes: (...args: unknown[]) =>
    mockSumRecordingChunkBytes(...args),
}));

vi.mock("../../../../lib/recordings.js", () => ({
  getEventOwnerContext: (...args: unknown[]) =>
    mockGetEventOwnerContext(...args),
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
}));

vi.mock("../../../../lib/resumable-session.js", () => ({
  deleteResumableSession: (...args: unknown[]) =>
    mockDeleteResumableSession(...args),
  getResumableSession: (...args: unknown[]) => mockGetResumableSession(...args),
  setResumableSession: (...args: unknown[]) => mockSetResumableSession(...args),
}));

vi.mock("../../../../lib/upload-lease.js", () => ({
  renewUploadLease: (...args: unknown[]) => mockRenewUploadLease(...args),
  uploadLeaseExpiry: () => "2099-01-01T00:00:00.000Z",
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
    mockDeleteResumableSession.mockResolvedValue(undefined);
    mockSetResumableSession.mockResolvedValue(undefined);
    mockIsStreamingUploadDisabled.mockReturnValue(false);
    mockShouldRejectVideoUploadWithoutStorage.mockResolvedValue(false);
    mockAllowsSqlRecordingChunkScratch.mockReturnValue(true);
    mockIsFeatureFlagEnabled.mockResolvedValue(true);
    mockResolveResumableUploadProvider.mockResolvedValue({
      resumable: {
        relayChunk: mockRelayChunk,
        abortSession: mockAbortSession,
      },
    });
    mockAbortSession.mockResolvedValue(undefined);
    mockRelayChunk.mockResolvedValue({ ok: true, status: 308 });
    mockFinalizeRun.mockResolvedValue({
      id: "rec-1",
      status: "ready",
      videoUrl: "/api/video/rec-1",
    });
    // The lease is a compare-and-set on the recording's status, so the fake
    // mirrors that: in-progress rows hold it, terminal rows do not.
    mockRenewUploadLease.mockImplementation(async () => {
      const row = mockSelectRows.rows[0] as Record<string, any> | undefined;
      if (row?.status === "uploading" || row?.status === "processing") {
        return { held: true };
      }
      return {
        held: false,
        status: row?.status ?? null,
        failureReason: row?.failureReason ?? null,
        videoUrl: row?.videoUrl ?? null,
        videoSizeBytes: row?.videoSizeBytes ?? null,
        durationMs: row?.durationMs ?? null,
      };
    });
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

  it("rejects chunk indices that cannot fit the exact scratch-key contract", async () => {
    setRequest({
      query: {
        index: "1000000",
        total: "1000001",
        mimeType: "video/webm",
      },
      body: new Uint8Array([1]),
    });

    await expect(handler({} as any)).rejects.toMatchObject({
      message: "Invalid chunk index",
      statusCode: 400,
    });

    expect(mockReadRawBody).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("rejects a stale retry token before reading or storing its chunk", async () => {
    mockRenewUploadLease.mockResolvedValueOnce({
      held: false,
      staleAttempt: true,
      status: "uploading",
      failureReason: null,
      videoUrl: null,
      videoSizeBytes: null,
      durationMs: null,
    });
    setRequest({
      query: {
        index: "0",
        total: "2",
        isFinal: "0",
        mimeType: "video/webm",
        attemptId: "stale-attempt",
      },
      body: new Uint8Array([1, 2, 3]),
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: false,
      error: "A newer upload retry is already active.",
      staleAttempt: true,
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockReadRawBody).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("forces a full restart when the retry flag switches off between chunks", async () => {
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "sess-1",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 0,
      lastCommittedIndex: -1,
    });
    mockIsFeatureFlagEnabled
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    setRequest({
      query: {
        index: "0",
        total: "2",
        mimeType: "video/webm",
        attemptId: "retry-attempt",
      },
      body: new Uint8Array([1, 2, 3]),
    });
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      finalized: false,
      index: 0,
      bytes: 3,
    });

    setRequest({
      query: {
        index: "1",
        total: "2",
        mimeType: "video/webm",
        attemptId: "retry-attempt",
      },
      body: new Uint8Array([4, 5, 6]),
    });
    await expect(handler({} as any)).resolves.toEqual({
      ok: false,
      error: "Resumable upload retry is disabled.",
      restartRequired: true,
      recoveryEnabled: false,
    });
    expect(mockSetResponseStatus).toHaveBeenLastCalledWith({}, 409);
    expect(mockReadRawBody).toHaveBeenCalledOnce();
    expect(mockRelayChunk).toHaveBeenCalledOnce();
    expect(mockRenewUploadLease).toHaveBeenCalledTimes(3);
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
    // Progress rides along on the lease renewal — one row write per chunk.
    expect(
      mockRenewUploadLease.mock.calls.filter(
        ([, options]) => options?.uploadProgress !== undefined,
      ),
    ).toEqual([
      ["rec-1", { attemptId: null, generationId: null, uploadProgress: 25 }],
      ["rec-1", { attemptId: null, generationId: null, uploadProgress: 50 }],
    ]);
    expect(mockUpdateSets).toEqual([]);
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
    // /abort flips the row to failed, so the lease renewal updates zero rows.
    // There is no window to re-check: the request cannot write past this.
    mockRenewUploadLease.mockResolvedValue({
      held: false,
      status: "failed",
      failureReason: "Recording was cancelled.",
      videoUrl: null,
      videoSizeBytes: null,
      durationMs: null,
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
      null,
    );
    expect(chunkKeys()).toEqual([]);
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("revalidates the lease after reading the body before persisting a chunk", async () => {
    mockRenewUploadLease
      .mockResolvedValueOnce({ held: true })
      .mockResolvedValueOnce({
        held: false,
        status: "failed",
        failureReason: "Recording was cancelled.",
        videoUrl: null,
        videoSizeBytes: null,
        durationMs: null,
      });
    setRequest({
      query: { index: "0", total: "2", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3]),
    });

    await expect(handler({} as any)).resolves.toMatchObject({
      ok: false,
      error: "Recording was cancelled.",
    });

    expect(mockRenewUploadLease).toHaveBeenCalledTimes(2);
    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("acks a retried final chunk after the recording is ready without rewriting state", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "ready",
        failureReason: null,
        ownerEmail: "owner@example.com",
        videoUrl: "/api/video/rec-1",
        videoSizeBytes: 581_614_005,
        durationMs: 1_592_773,
      },
    ];
    mockAppState.set(UPLOAD_KEY, {
      recordingId: "rec-1",
      status: "ready",
      sourceSizeBytes: 581_614_005,
    });
    setRequest({
      query: { index: "2", total: "3", isFinal: "1", mimeType: "video/webm" },
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        finalized: true,
        status: "ready",
        sourceSizeBytes: 581_614_005,
        durationMs: 1_592_773,
      }),
    );

    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("returns 202 when final media verification is durably queued", async () => {
    mockAppState.set(`${CHUNK_PREFIX}000000`, { bytes: 10 });
    mockFinalizeRun.mockResolvedValue({
      id: "rec-1",
      status: "processing",
      verificationPending: true,
      videoUrl: "https://cdn.example/rec-1.webm",
      videoSizeBytes: 10,
      sourceSizeBytes: 10,
      durationMs: 1_234,
    });
    setRequest({
      query: {
        index: "1",
        total: "2",
        isFinal: "1",
        mimeType: "video/webm",
      },
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        finalized: false,
        status: "processing",
        verificationPending: true,
        retryAfterMs: 3_000,
        sourceSizeBytes: 10,
      }),
    );
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 202);
  });

  it("acks a duplicate final during verification without touching the provider", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "processing",
        failureReason: null,
        ownerEmail: "owner@example.com",
        videoUrl: "https://cdn.example/rec-1.webm",
      },
    ];
    mockAppState.set(UPLOAD_KEY, {
      recordingId: "rec-1",
      status: "processing",
      pendingMediaVerification: true,
      videoUrl: "https://cdn.example/rec-1.webm",
      videoSizeBytes: 10,
      sourceSizeBytes: 10,
      durationMs: 1_234,
    });
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "stale-session",
      meta: {},
      bytesUploaded: 10,
    });
    setRequest({
      query: {
        index: "1",
        total: "2",
        isFinal: "1",
        mimeType: "video/webm",
      },
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        finalized: false,
        status: "processing",
        verificationPending: true,
      }),
    );
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 202);
    expect(mockRelayChunk).not.toHaveBeenCalled();
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

  it("preserves buffered source-byte proof when finalize committed before its response was lost", async () => {
    mockAppState.set(`${CHUNK_PREFIX}000000`, { bytes: 10 });
    mockAppState.set(UPLOAD_KEY, {
      recordingId: "rec-1",
      status: "uploading",
      bytesReceived: 10,
    });
    mockFinalizeRun.mockImplementationOnce(async () => {
      mockSelectRows.rows = [
        {
          id: "rec-1",
          status: "ready",
          videoUrl: "https://cdn.example/rec-1.webm",
          videoSizeBytes: 10,
          durationMs: 1_234,
          width: 1280,
          height: 720,
          hasAudio: true,
          hasCamera: false,
        },
      ];
      throw new Error("response connection closed");
    });
    setRequest({
      query: {
        index: "1",
        total: "2",
        isFinal: "1",
        mimeType: "video/webm",
      },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          finalized: true,
          recoveredAfterFinalizeError: true,
          sourceSizeBytes: 10,
        }),
      );
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }

    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        status: "ready",
        bytesReceived: 10,
        sourceSizeBytes: 10,
      }),
    );
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
    expect(mockSetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      {
        providerId: "s3",
        sessionId: "sess-1",
        meta: { objectKey: "clips/rec-1.webm" },
        bytesUploaded: 105,
        lastCommittedIndex: 3,
      },
      null,
    );
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("aborts and surfaces a provider error on the final resumable chunk", async () => {
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "sess-final",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 100,
      lastCommittedIndex: 2,
    });
    mockRelayChunk.mockRejectedValueOnce(
      new Error("S3 staging object read failed (500)"),
    );
    setRequest({
      query: {
        index: "3",
        total: "4",
        isFinal: "1",
        mimeType: "video/webm",
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual({
        ok: false,
        error: "Final chunk upload failed: S3 staging object read failed (500)",
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "sess-final",
      meta: { objectKey: "clips/rec-1.webm" },
    });
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1", null);
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

  it("retires an expired provider session so the desktop can restart safely", async () => {
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "expired-session",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 100,
      lastCommittedIndex: 2,
    });
    mockRelayChunk.mockResolvedValue({ ok: false, status: 410 });
    setRequest({
      query: { index: "3", total: "0", mimeType: "video/webm" },
      body: new Uint8Array([1, 2, 3]),
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: false,
      error: "Chunk upload failed (410)",
      restartRequired: true,
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1", null);
    expect(mockSetResumableSession).not.toHaveBeenCalled();
  });

  it("keeps replacement-generation scratch when a stale writer loses its lease", async () => {
    (mockSelectRows.rows[0] as Record<string, unknown>).uploadGenerationId =
      "generation-a";
    // A gets admitted and reads its body. While it is in flight, reset moves
    // the row to B; A's pre-write renewal must then clean only A scratch.
    mockRenewUploadLease
      .mockResolvedValueOnce({ held: true })
      .mockImplementationOnce(async () => {
        (mockSelectRows.rows[0] as Record<string, unknown>).uploadGenerationId =
          "generation-b";
        return { held: false, staleAttempt: true };
      });
    setRequest({
      query: {
        index: "0",
        total: "1",
        mimeType: "video/webm",
        uploadGenerationId: "generation-a",
      },
      body: new Uint8Array([1]),
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );

    // The loser may clean up only its own generation; B's scratch is never a
    // valid target for a delayed A request.
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      "generation-a",
    );
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      "generation-b",
    );
  });

  it("does not delete a replacement session when an old provider response expires", async () => {
    (mockSelectRows.rows[0] as Record<string, unknown>).uploadGenerationId =
      "generation-a";
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "old-session",
      meta: {},
      bytesUploaded: 100,
      lastCommittedIndex: 0,
    });
    mockRenewUploadLease
      .mockResolvedValueOnce({ held: true })
      .mockResolvedValueOnce({ held: true });
    mockRelayChunk.mockImplementationOnce(async () => {
      // B exists before A receives the delayed provider expiry.
      (mockSelectRows.rows[0] as Record<string, unknown>).uploadGenerationId =
        "generation-b";
      return { ok: false, status: 410 };
    });
    setRequest({
      query: {
        index: "1",
        mimeType: "video/webm",
        uploadGenerationId: "generation-a",
      },
      body: new Uint8Array([1]),
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ restartRequired: true }),
    );
    expect(mockDeleteResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-a",
    );
    expect(mockDeleteResumableSession).not.toHaveBeenCalledWith(
      "rec-1",
      "generation-b",
    );
  });

  it("does not restore a replacement session after a delayed old provider success", async () => {
    (mockSelectRows.rows[0] as Record<string, unknown>).uploadGenerationId =
      "generation-a";
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "old-session",
      meta: {},
      bytesUploaded: 100,
      lastCommittedIndex: 0,
    });
    // This test owns all three lease boundaries: A admission, A provider
    // dispatch, then the post-provider fence after reset installed B.
    mockRenewUploadLease
      .mockResolvedValueOnce({ held: true })
      .mockResolvedValueOnce({ held: true })
      .mockResolvedValueOnce({ held: false, staleAttempt: true });
    mockRelayChunk.mockImplementationOnce(async () => {
      (mockSelectRows.rows[0] as Record<string, unknown>).uploadGenerationId =
        "generation-b";
      return { ok: true, status: 308 };
    });
    setRequest({
      query: {
        index: "1",
        mimeType: "video/webm",
        uploadGenerationId: "generation-a",
      },
      body: new Uint8Array([1]),
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(mockSetResumableSession).not.toHaveBeenCalled();
    expect(mockSetResumableSession).not.toHaveBeenCalledWith(
      "rec-1",
      expect.anything(),
      "generation-b",
    );
  });

  it("returns exact resumable source-byte proof when finalize committed before its response was lost", async () => {
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "sess-1",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 100,
      lastCommittedIndex: 2,
    });
    mockRelayChunk.mockResolvedValue({ ok: true, status: 200 });
    mockFinalizeRun.mockImplementationOnce(async () => {
      mockSelectRows.rows = [
        {
          id: "rec-1",
          status: "ready",
          videoUrl: "https://cdn.example/rec-1.webm",
          videoSizeBytes: 105,
          durationMs: 1_234,
          width: 1280,
          height: 720,
          hasAudio: true,
          hasCamera: false,
        },
      ];
      throw new Error("response connection closed");
    });
    setRequest({
      query: {
        index: "3",
        total: "4",
        isFinal: "1",
        mimeType: "video/webm",
      },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          finalized: true,
          recoveredAfterFinalizeError: true,
          sourceSizeBytes: 105,
        }),
      );
    } finally {
      consoleLog.mockRestore();
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }

    expect(mockAppState.get(UPLOAD_KEY)).toEqual(
      expect.objectContaining({
        status: "ready",
        sourceSizeBytes: 105,
      }),
    );
  });
});
