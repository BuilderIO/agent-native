import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockDeleteAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetAppState = vi.hoisted(() => vi.fn());
const mockPendingCleanup = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const mockDeleteRecordingChunks = vi.hoisted(() => vi.fn());
const mockGetActiveFileUploadProviderForRequest = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockIsFeatureFlagEnabled = vi.hoisted(() => vi.fn());
const mockGetEventOwnerContext = vi.hoisted(() => vi.fn());
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockDeleteResumableSession = vi.hoisted(() => vi.fn());
const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockSetResumableSession = vi.hoisted(() => vi.fn());
const mockStartSession = vi.hoisted(() => vi.fn());
const mockAbortSession = vi.hoisted(() => vi.fn());
const mockRenewUploadLease = vi.hoisted(() => vi.fn());
const mockShouldEnableStreamingUpload = vi.hoisted(() => vi.fn());
const mockAllowsSqlRecordingChunkScratch = vi.hoisted(() => vi.fn());
const mockIsMediaVerificationPending = vi.hoisted(() => vi.fn());
const mockUpdateSets = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockResetWins = vi.hoisted(() => ({ current: true }));
const mockReplaceCleanupOnRelease = vi.hoisted(() => ({ current: false }));
const mockExistingRecording = vi.hoisted(() => ({
  current: {
    id: "rec-1",
    status: "uploading",
    videoUrl: null as string | null,
    uploadAttemptId: null as string | null,
    uploadGenerationId: null as string | null,
  },
}));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(async () => [mockExistingRecording.current]),
    };
    return builder;
  }),
  update: vi.fn(() => {
    const builder = {
      set: vi.fn((values: Record<string, unknown>) => {
        mockUpdateSets.push(values);
        return builder;
      }),
      where: vi.fn(() => builder),
      returning: vi.fn(async () =>
        mockResetWins.current ? [{ id: "rec-1" }] : [],
      ),
    };
    return builder;
  }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: (...args: unknown[]) =>
    mockCompareAndSetAppState(...args),
  deleteAppState: (...args: unknown[]) => mockDeleteAppState(...args),
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    mockGetActiveFileUploadProviderForRequest(...args),
}));

vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: (...args: unknown[]) =>
    mockIsFeatureFlagEnabled(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  isNull: vi.fn(() => "is-null"),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  readBody: (...args: unknown[]) => mockReadBody(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../../db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      uploadAttemptId: "recordings.uploadAttemptId",
      uploadGenerationId: "recordings.uploadGenerationId",
      failureReason: "recordings.failureReason",
      uploadProgress: "recordings.uploadProgress",
      updatedAt: "recordings.updatedAt",
    },
  },
}));

vi.mock("../../../../lib/recordings.js", () => ({
  getEventOwnerContext: (...args: unknown[]) =>
    mockGetEventOwnerContext(...args),
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
}));

vi.mock("../../../../lib/recording-upload-state.js", () => ({
  deleteRecordingChunks: (...args: unknown[]) =>
    mockDeleteRecordingChunks(...args),
}));

vi.mock("../../../../lib/media-verification-state.js", () => ({
  isMediaVerificationPending: (...args: unknown[]) =>
    mockIsMediaVerificationPending(...args),
}));

vi.mock("../../../../lib/resumable-session.js", () => ({
  deleteResumableSession: (...args: unknown[]) =>
    mockDeleteResumableSession(...args),
  getResumableSession: (...args: unknown[]) => mockGetResumableSession(...args),
  setResumableSession: (...args: unknown[]) => mockSetResumableSession(...args),
}));

vi.mock("../../../../lib/streaming-upload-mode.js", () => ({
  shouldEnableStreamingUpload: (...args: unknown[]) =>
    mockShouldEnableStreamingUpload(...args),
}));

vi.mock("../../../../lib/upload-lease.js", () => ({
  renewUploadLease: (...args: unknown[]) => mockRenewUploadLease(...args),
  uploadLeaseExpiry: () => "2099-01-01T00:00:00.000Z",
}));

vi.mock("../../../../lib/video-storage.js", () => ({
  allowsSqlRecordingChunkScratch: (...args: unknown[]) =>
    mockAllowsSqlRecordingChunkScratch(...args),
}));

import handler from "./reset-chunks.post";

describe("/api/uploads/:recordingId/reset-chunks route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSets.length = 0;
    mockResetWins.current = true;
    mockReplaceCleanupOnRelease.current = false;
    mockGetRouterParam.mockReturnValue("rec-1");
    mockGetEventOwnerContext.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockDeleteRecordingChunks.mockResolvedValue(3);
    mockDeleteResumableSession.mockResolvedValue(undefined);
    mockGetResumableSession.mockResolvedValue(null);
    mockSetResumableSession.mockResolvedValue(undefined);
    mockPendingCleanup.current = null;
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "recording-resumable-cleanup-rec-1"
        ? mockPendingCleanup.current
        : {
            recordingId: "rec-1",
            status: "uploading",
          },
    );
    mockWriteAppState.mockImplementation(
      async (key: string, value: Record<string, unknown>) => {
        if (key === "recording-resumable-cleanup-rec-1") {
          mockPendingCleanup.current = value;
        }
      },
    );
    mockDeleteAppState.mockImplementation(async (key: string) => {
      if (key === "recording-resumable-cleanup-rec-1") {
        mockPendingCleanup.current = null;
      }
      return true;
    });
    mockCompareAndSetAppState.mockImplementation(
      async (
        key: string,
        expected: Record<string, unknown> | null,
        next: Record<string, unknown> | null,
      ) => {
        if (key === "recording-resumable-cleanup-rec-1") {
          const current = mockPendingCleanup.current;
          if (JSON.stringify(current) !== JSON.stringify(expected)) {
            return false;
          }
          if (next === null && mockReplaceCleanupOnRelease.current) {
            mockPendingCleanup.current = {
              recordingId: "rec-1",
              generationId: "generation-old",
              ownerGenerationId: "generation-newer",
              claimId: "newer-claim",
              session: {
                providerId: "test-provider",
                sessionId: "newer-session",
                meta: { objectKey: "clips/rec-1-newer.webm" },
                bytesUploaded: 0,
              },
            };
            return false;
          }
          mockPendingCleanup.current = next;
        }
        return true;
      },
    );
    mockRenewUploadLease.mockResolvedValue({ held: true });
    mockAbortSession.mockResolvedValue(undefined);
    mockAllowsSqlRecordingChunkScratch.mockReturnValue(false);
    mockShouldEnableStreamingUpload.mockReturnValue(true);
    mockIsMediaVerificationPending.mockResolvedValue(false);
    mockIsFeatureFlagEnabled.mockResolvedValue(true);
    mockExistingRecording.current = {
      id: "rec-1",
      status: "uploading",
      videoUrl: null,
      uploadAttemptId: null,
      uploadGenerationId: null,
    };
    mockStartSession.mockResolvedValue({
      sessionId: "session-1",
      meta: { provider: "test" },
    });
    mockGetActiveFileUploadProviderForRequest.mockResolvedValue({
      id: "test-provider",
      resumable: {
        startSession: mockStartSession,
        abortSession: mockAbortSession,
      },
    });
  });

  it("clears a recovery claim when the flag is disabled mid-retry", async () => {
    mockIsFeatureFlagEnabled.mockResolvedValue(false);
    mockExistingRecording.current.uploadAttemptId = "old-attempt";
    mockReadBody.mockResolvedValue({
      requestStreaming: true,
      mimeType: "video/webm",
      useGenerationFence: true,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ ok: true, uploadGenerationId: null }),
    );
    expect(mockUpdateSets).toContainEqual(
      expect.objectContaining({
        uploadAttemptId: null,
        uploadGenerationId: null,
      }),
    );
  });

  it("recreates a resumable session for a browser backup retry", async () => {
    mockReadBody.mockResolvedValue({
      requestStreaming: true,
      mimeType: "video/webm;codecs=vp9,opus",
      useGenerationFence: true,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        recordingId: "rec-1",
        uploadMode: "streaming",
        chunksCleared: 3,
        uploadGenerationId: expect.any(String),
      }),
    );

    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1", null);
    expect(mockStartSession).toHaveBeenCalledWith(
      "rec-1.webm",
      "video/webm",
      expect.any(Number),
    );
    expect(mockSetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      {
        providerId: "test-provider",
        sessionId: "session-1",
        meta: { provider: "test", stableUrl: true, recordAsset: false },
        bytesUploaded: 0,
        lastCommittedIndex: -1,
      },
      expect.any(String),
    );
  });

  it("aborts the discarded provider session before replacing its local handle", async () => {
    mockExistingRecording.current.uploadGenerationId = "generation-old";
    mockReadBody.mockResolvedValue({
      requestStreaming: true,
      mimeType: "video/webm",
      uploadGenerationId: "generation-old",
      useGenerationFence: true,
    });
    mockGetResumableSession.mockResolvedValue({
      providerId: "test-provider",
      sessionId: "old-session",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 12,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        uploadMode: "streaming",
        uploadGenerationId: expect.any(String),
      }),
    );

    expect(mockGetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-old",
    );
    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "old-session",
      meta: { objectKey: "clips/rec-1.webm" },
    });
    expect(mockDeleteResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-old",
    );
  });

  it("does not leave a cleanup claim when it loses the generation fence", async () => {
    mockResetWins.current = false;
    mockExistingRecording.current.uploadGenerationId = "generation-old";
    mockReadBody.mockResolvedValue({
      uploadGenerationId: "generation-old",
      useGenerationFence: true,
    });
    mockGetResumableSession.mockResolvedValue({
      providerId: "test-provider",
      sessionId: "old-session",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 12,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ staleAttempt: true }),
    );
    expect(mockPendingCleanup.current).toBeNull();
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
    expect(mockAbortSession).not.toHaveBeenCalled();
  });

  it("does not release a cleanup claim replaced by a newer reset", async () => {
    mockReplaceCleanupOnRelease.current = true;
    mockExistingRecording.current.uploadGenerationId = "generation-old";
    mockReadBody.mockResolvedValue({
      uploadGenerationId: "generation-old",
      useGenerationFence: true,
    });
    mockGetResumableSession.mockResolvedValue({
      providerId: "test-provider",
      sessionId: "old-session",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 12,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(mockPendingCleanup.current).toEqual(
      expect.objectContaining({ claimId: "newer-claim" }),
    );
  });

  it("retains a cleanup claim when provider abort fails so a retry can finish it", async () => {
    mockExistingRecording.current.uploadGenerationId = "generation-old";
    mockReadBody.mockResolvedValue({
      uploadGenerationId: "generation-old",
      useGenerationFence: true,
    });
    mockGetResumableSession.mockResolvedValue({
      providerId: "test-provider",
      sessionId: "old-session",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 12,
    });
    mockAbortSession
      .mockRejectedValueOnce(new Error("provider cleanup failed"))
      .mockResolvedValue(true);

    await expect(handler({} as any)).resolves.toEqual({
      error:
        "The previous recording upload could not be cleaned up. Retry the upload restart.",
    });
    expect(mockPendingCleanup.current).toEqual(
      expect.objectContaining({
        recordingId: "rec-1",
        generationId: "generation-old",
      }),
    );
    const pendingOwnerGenerationId = (
      mockPendingCleanup.current as { ownerGenerationId: string }
    ).ownerGenerationId;
    expect(pendingOwnerGenerationId).toEqual(expect.any(String));

    mockExistingRecording.current.uploadGenerationId = pendingOwnerGenerationId;
    mockReadBody.mockResolvedValue({
      uploadGenerationId: pendingOwnerGenerationId,
      useGenerationFence: true,
    });
    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(mockAbortSession).toHaveBeenCalledTimes(2);
    expect(mockPendingCleanup.current).toBeNull();
    expect(mockDeleteResumableSession).toHaveBeenLastCalledWith(
      "rec-1",
      "generation-old",
    );
  });

  it("fences a claimed retry even without the browser opt-in", async () => {
    mockExistingRecording.current.uploadAttemptId = "attempt-1";
    mockReadBody.mockResolvedValue({ attemptId: "attempt-1" });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ uploadGenerationId: expect.any(String) }),
    );

    expect(mockUpdateSets).toContainEqual(
      expect.objectContaining({ uploadGenerationId: expect.any(String) }),
    );
  });

  it("keeps legacy native resets on the unfenced generation contract", async () => {
    mockReadBody.mockResolvedValue({
      requestStreaming: true,
      mimeType: "video/mp4",
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        uploadMode: "streaming",
        uploadGenerationId: null,
      }),
    );

    expect(mockUpdateSets).toContainEqual(
      expect.objectContaining({ uploadGenerationId: null }),
    );
    expect(mockSetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      expect.any(Object),
      null,
    );
  });

  it("keeps an explicitly buffered reset on the buffered path", async () => {
    mockReadBody.mockResolvedValue({});
    mockAllowsSqlRecordingChunkScratch.mockReturnValue(true);

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ uploadMode: "buffered" }),
    );

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockSetResumableSession).not.toHaveBeenCalled();
  });

  it("fails before claiming reset when upload state is unreadable", async () => {
    mockReadBody.mockResolvedValue({});
    mockReadAppState.mockRejectedValue(new Error("state store unavailable"));

    await expect(handler({} as any)).rejects.toThrow("state store unavailable");

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("compensates a provider session when abort wins during startup", async () => {
    mockReadBody.mockResolvedValue({
      requestStreaming: true,
      mimeType: "video/webm",
      useGenerationFence: true,
    });
    mockRenewUploadLease.mockResolvedValue({
      held: false,
      staleAttempt: true,
      status: "failed",
    });

    await expect(handler({} as any)).resolves.toEqual({
      error: "Recording upload changed while its retry was starting.",
      staleAttempt: true,
    });

    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      meta: { provider: "test" },
    });
    expect(mockDeleteResumableSession).toHaveBeenLastCalledWith(
      "rec-1",
      expect.any(String),
    );
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("does not reset a recording that is already ready", async () => {
    mockReadBody.mockResolvedValue({});
    mockExistingRecording.current = {
      id: "rec-1",
      status: "ready",
      videoUrl: "https://cdn.example/video.webm",
      uploadAttemptId: null,
      uploadGenerationId: null,
    };

    await expect(handler({} as any)).resolves.toEqual({
      error: "Recording is already ready",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("does not reset a recording with durable verification pending", async () => {
    mockReadBody.mockResolvedValue({});
    mockExistingRecording.current = {
      id: "rec-1",
      status: "processing",
      videoUrl: "https://cdn.example/video.webm",
      uploadAttemptId: null,
      uploadGenerationId: null,
    };
    mockIsMediaVerificationPending.mockResolvedValue(true);

    await expect(handler({} as any)).resolves.toEqual({
      error: "Recording is still being verified",
    });

    expect(mockIsMediaVerificationPending).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      recordingId: "rec-1",
      recordingStatus: "processing",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
    expect(mockUpdateSets).toHaveLength(0);
  });
});
