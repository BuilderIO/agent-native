import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetManyAppState = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockDeleteRecordingChunks = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetEventOwnerContext = vi.hoisted(() => vi.fn());
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockDeleteResumableSession = vi.hoisted(() => vi.fn());
const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockAbortSession = vi.hoisted(() => vi.fn());
const mockResolveResumableUploadProvider = vi.hoisted(() => vi.fn());
const mockUpdateSets = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockEqCalls = vi.hoisted(() => [] as unknown[][]);
const mockUpdateRows = vi.hoisted(() => ({
  rows: [{ id: "rec-1" }] as Array<{
    id: string;
    uploadGenerationId?: string;
  }>,
}));
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
  update: vi.fn(() => {
    const builder = {
      set: vi.fn((values: Record<string, unknown>) => {
        mockUpdateSets.push(values);
        return builder;
      }),
      where: vi.fn(() => builder),
      returning: vi.fn(async () => mockUpdateRows.rows),
    };
    return builder;
  }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetManyAppState: (...args: unknown[]) =>
    mockCompareAndSetManyAppState(...args),
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
  eq: (...args: unknown[]) => {
    mockEqCalls.push(args);
    return "eq";
  },
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
      authUserId: "recordings.authUserId",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      failureReason: "recordings.failureReason",
      uploadAttemptId: "recordings.uploadAttemptId",
      uploadGenerationId: "recordings.uploadGenerationId",
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

vi.mock("../../../../lib/resumable-session.js", () => ({
  deleteResumableSession: (...args: unknown[]) =>
    mockDeleteResumableSession(...args),
  getResumableSession: (...args: unknown[]) => mockGetResumableSession(...args),
}));

vi.mock("../../../../lib/resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: (...args: unknown[]) =>
    mockResolveResumableUploadProvider(...args),
}));

import handler from "./abort.post";

describe("/api/uploads/:recordingId/abort route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: "Upload was stored-but-unservable: media URL timed out",
      },
    ];
    mockUpdateSets.length = 0;
    mockEqCalls.length = 0;
    mockUpdateRows.rows = [{ id: "rec-1" }];
    mockGetRouterParam.mockReturnValue("rec-1");
    mockReadBody.mockResolvedValue({
      reason: "Upload was stored-but-unservable: media URL timed out",
    });
    mockGetEventOwnerContext.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockDeleteRecordingChunks.mockResolvedValue(2);
    mockCompareAndSetManyAppState.mockResolvedValue(true);
    mockDeleteResumableSession.mockResolvedValue(undefined);
    mockGetResumableSession.mockResolvedValue(null);
    mockAbortSession.mockResolvedValue(undefined);
    mockResolveResumableUploadProvider.mockResolvedValue({
      resumable: { abortSession: mockAbortSession },
    });
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "recording-media-verification-rec-1"
        ? null
        : {
            recordingId: "rec-1",
            status: "uploading",
            mimeType: "video/mp4",
            durationMs: 1234,
            width: 1280,
            height: 720,
            hasAudio: true,
            hasCamera: false,
          },
    );
    mockWriteAppState.mockResolvedValue(undefined);
  });

  it("preserves buffered chunks after stored-but-unservable finalize failures", async () => {
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 0,
    });

    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "recording-upload-rec-1",
        nextValue: expect.objectContaining({
          recordingId: "rec-1",
          status: "failed",
          mimeType: "video/mp4",
          durationMs: 1234,
          width: 1280,
          height: 720,
          hasAudio: true,
          hasCamera: false,
        }),
      }),
    ]);
    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          failureReason:
            "Upload was stored-but-unservable: media URL timed out",
        }),
      ]),
    );
  });

  it("classifies aborts without a normalized cause as unknown", async () => {
    mockReadBody.mockResolvedValue({ failureCode: "upload_failed" });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          failureCode: "unknown",
          failureReason: "unknown",
        }),
      ]),
    );
  });

  it.each([
    "Recording cancelled by user",
    "Recording cancelled during countdown",
    "Upload cancelled",
  ])("maps the legacy cancellation reason %s", async (reason) => {
    mockReadBody.mockResolvedValue({ reason });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ failureCode: "user_cancelled" }),
      ]),
    );
  });

  it("does not treat the ambiguous legacy abort message as a cancellation", async () => {
    mockReadBody.mockResolvedValue({ reason: "Upload aborted by user" });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ failureCode: "unknown" }),
      ]),
    );
  });

  it("keeps user cancellation distinct from upload failure", async () => {
    mockReadBody.mockResolvedValue({
      reason: "user_cancelled",
      failureCode: "user_cancelled",
    });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ failureCode: "user_cancelled" }),
      ]),
    );
  });

  it("preserves a specific server failure during later abort cleanup", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        videoUrl: null,
        failureCode: "finalize_failed",
        failureReason: "Finalization failed after upload",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Upload failed",
      failureCode: "upload_failed",
    });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureCode: "finalize_failed",
          failureReason: "Finalization failed after upload",
        }),
      ]),
    );
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({
        nextValue: expect.objectContaining({
          failureReason: "Finalization failed after upload",
        }),
      }),
    ]);
  });

  it("keeps an unknown failed row from becoming a user cancellation", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        videoUrl: null,
        failureCode: null,
        failureReason: "Upload aborted by user",
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Recording cancelled by user",
      failureCode: "user_cancelled",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureCode: "unknown",
          failureReason: "Upload aborted by user",
        }),
      ]),
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("rejects an abort from an older generation with the same attempt ID", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        failureCode: null,
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-current",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Upload failed",
      failureCode: "upload_failed",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-old",
    });

    await expect(handler({} as any)).resolves.toMatchObject({
      error: "A newer upload retry is already active.",
      staleAttempt: true,
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
  });

  it("allows same-attempt cancellation after reset advances the generation", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        failureCode: null,
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-current",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Recording cancelled by user",
      failureCode: "user_cancelled",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-before-reset",
    });

    await expect(handler({} as any)).resolves.toMatchObject({ ok: true });

    expect(mockEqCalls).toContainEqual([
      "recordings.uploadAttemptId",
      "attempt-1",
    ]);
    expect(mockEqCalls).not.toContainEqual([
      "recordings.uploadGenerationId",
      "generation-current",
    ]);
    expect(mockGetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-current",
    );
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      "generation-current",
    );
  });

  it("fences the update by generation even when an attempt ID is present", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        failureCode: null,
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-current",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Upload failed",
      failureCode: "upload_failed",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-current",
    });

    await handler({} as any);

    expect(mockEqCalls).toContainEqual([
      "recordings.uploadAttemptId",
      "attempt-1",
    ]);
    expect(mockEqCalls).toContainEqual([
      "recordings.uploadGenerationId",
      "generation-current",
    ]);
  });

  it("accepts only bounded stage and HTTP status diagnostics", async () => {
    mockReadBody.mockResolvedValue({
      reason: "chunk upload returned an HTML error response",
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
      httpStatus: 502,
    });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ failureCode: "chunk_html_error" }),
      ]),
    );
  });

  it("classifies legacy reset-chunks HTML errors and records their stage", async () => {
    mockReadBody.mockResolvedValue({
      reason:
        "Couldn't prepare the recording for re-upload (reset-chunks 2). <!DOCTYPE html><html>",
      failureCode: "upload_failed",
    });

    await handler({} as any);

    expect(mockUpdateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureCode: "chunk_html_error",
          failureReason: "Upload returned an HTML error response.",
        }),
      ]),
    );
    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.objectContaining({
        failure_code: "chunk_html_error",
        failure_stage: "reset_chunks",
      }),
      { userId: "owner@example.com" },
    );
    expect(mockTrack.mock.calls[0]?.[1]).not.toHaveProperty("failure_reason");
    expect(JSON.stringify(mockTrack.mock.calls[0]?.[1])).not.toContain(
      "<!DOCTYPE html>",
    );
    expect(JSON.stringify(mockUpdateSets)).not.toContain("<!DOCTYPE html>");
  });

  it("does not let an older client abort durable media verification", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "processing",
        videoUrl: "https://cdn.example.com/rec-1",
        failureReason: null,
      },
    ];
    mockReadAppState.mockResolvedValue({
      recordingId: "rec-1",
      status: "processing",
      pendingMediaVerification: true,
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      verificationPending: true,
      chunksCleared: 0,
    });

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
  });

  it("clears buffered chunks for ordinary abort failures", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Network upload failed" });

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      null,
    );
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1", null);
  });

  it("aborts provider storage before deleting a resumable session", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Cancelled" });
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "upload-example",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 123,
    });

    await handler({} as any);

    expect(mockResolveResumableUploadProvider).toHaveBeenCalledWith("s3");
    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "upload-example",
      meta: { objectKey: "clips/rec-1.webm" },
    });
    expect(mockAbortSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteResumableSession.mock.invocationCallOrder[0],
    );
  });

  it("addresses the active generation-scoped session on abort", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      uploadGenerationId: "generation-1",
    });
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "upload-example",
      meta: {},
      bytesUploaded: 123,
    });

    await handler({} as any);

    expect(mockGetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-1",
    );
    expect(mockDeleteResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-1",
    );
  });

  it("cleans a provider session created after the abort preflight read", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      uploadGenerationId: "generation-1",
    });
    mockGetResumableSession.mockResolvedValueOnce(null).mockResolvedValueOnce({
      providerId: "s3",
      sessionId: "late-session",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 0,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );

    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "late-session",
      meta: { objectKey: "clips/rec-1.webm" },
    });
    expect(mockDeleteResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-1",
    );
  });

  it("does not clean up when a replacement generation wins the abort CAS", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      uploadGenerationId: "generation-1",
    });
    mockUpdateRows.rows = [];

    await expect(handler({} as any)).resolves.toEqual({
      error: "A newer upload retry is already active.",
      staleAttempt: true,
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockGetResumableSession).toHaveBeenCalledWith(
      "rec-1",
      "generation-1",
    );
  });

  it("retries cancellation when finalization wins the state publication CAS", async () => {
    const uploading = {
      id: "rec-1",
      status: "uploading",
      videoUrl: null,
      failureReason: null,
      failureCode: null,
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    };
    const processing = { ...uploading, status: "processing" };
    mockSelectRows.rows = [uploading];
    mockReadBody.mockResolvedValue({
      reason: "Network request failed",
      failureCode: "upload_failed",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    });
    const uploadState = {
      recordingId: "rec-1",
      status: "uploading",
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    };
    const finalizedUploadState = {
      recordingId: "rec-1",
      status: "processing",
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    };
    const uploadStates = [uploadState, finalizedUploadState];
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "recording-media-verification-rec-1"
        ? null
        : uploadStates.shift(),
    );
    mockCompareAndSetManyAppState.mockImplementationOnce(async () => {
      mockSelectRows.rows = [processing];
      return false;
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockCompareAndSetManyAppState).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        key: "recording-upload-rec-1",
        expectedValue: uploadState,
        nextValue: expect.objectContaining({ status: "failed" }),
      }),
    ]);
    expect(mockCompareAndSetManyAppState).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        key: "recording-upload-rec-1",
        expectedValue: expect.objectContaining({ status: "processing" }),
        nextValue: expect.objectContaining({ status: "failed" }),
      }),
    ]);
    expect(mockEqCalls).toContainEqual(["recordings.status", "processing"]);
    expect(mockEqCalls).toContainEqual([
      "recordings.uploadAttemptId",
      "attempt-1",
    ]);
    expect(mockEqCalls).toContainEqual([
      "recordings.uploadGenerationId",
      "generation-1",
    ]);
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      "generation-1",
    );
  });

  it("aborts the SQL retry after reset leaves the previous app state published", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        failureCode: null,
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-2",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Recording cancelled by user",
      failureCode: "user_cancelled",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-2",
    });
    const previousGenerationState = {
      recordingId: "rec-1",
      status: "uploading",
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    };
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "recording-media-verification-rec-1"
        ? null
        : previousGenerationState,
    );

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "recording-upload-rec-1",
        expectedValue: previousGenerationState,
        nextValue: expect.objectContaining({
          status: "failed",
          uploadAttemptId: "attempt-1",
          uploadGenerationId: "generation-2",
        }),
      }),
    ]);
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      "generation-2",
    );
  });

  it("rejects a legacy abort for an older generation", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: "generation-2",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      uploadGenerationId: "generation-1",
    });

    await expect(handler({} as any)).resolves.toEqual({
      error: "A newer upload retry is already active.",
      staleAttempt: true,
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("cancels a reset generation that keeps the same upload attempt", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      attemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    });
    mockUpdateRows.rows = [{ id: "rec-1", uploadGenerationId: "generation-2" }];

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockGetResumableSession).toHaveBeenLastCalledWith(
      "rec-1",
      "generation-2",
    );
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      "generation-2",
    );
  });

  it("preserves replacement auxiliary state that changes after the abort CAS", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      uploadGenerationId: "generation-1",
    });
    mockReadAppState
      .mockResolvedValueOnce({
        recordingId: "rec-1",
        status: "uploading",
        uploadGenerationId: "generation-1",
      })
      .mockResolvedValueOnce({
        recordingId: "rec-1",
        pendingMediaVerification: true,
      });
    mockCompareAndSetManyAppState
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual({
        ok: true,
        recordingId: "rec-1",
        chunksCleared: 2,
      });
    } finally {
      consoleInfo.mockRestore();
    }

    expect(mockCompareAndSetManyAppState).toHaveBeenNthCalledWith(1, [
      {
        key: "recording-upload-rec-1",
        expectedValue: {
          recordingId: "rec-1",
          status: "uploading",
          uploadGenerationId: "generation-1",
        },
        nextValue: expect.objectContaining({ status: "failed" }),
      },
    ]);
    expect(mockCompareAndSetManyAppState).toHaveBeenNthCalledWith(2, [
      {
        key: "recording-media-verification-rec-1",
        expectedValue: {
          recordingId: "rec-1",
          pendingMediaVerification: true,
        },
        nextValue: null,
      },
    ]);
    expect(mockWriteAppState).toHaveBeenCalledTimes(1);
    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("surfaces upload-state claim failures before claiming the row", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: null,
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Cancelled" });
    mockCompareAndSetManyAppState.mockRejectedValue(
      new Error("application state unavailable"),
    );

    await expect(handler({} as any)).rejects.toThrow(
      "application state unavailable",
    );

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("fails before claiming the row when resumable state is unreadable", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: "generation-1",
      },
    ];
    mockReadBody.mockResolvedValue({
      reason: "Cancelled",
      uploadGenerationId: "generation-1",
    });
    mockGetResumableSession.mockRejectedValue(
      new Error("session store unavailable"),
    );

    await expect(handler({} as any)).rejects.toThrow(
      "session store unavailable",
    );

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
  });

  it("retries exact cleanup after an auxiliary-state failure", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
        uploadAttemptId: null,
        uploadGenerationId: null,
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Cancelled" });
    mockCompareAndSetManyAppState
      .mockRejectedValueOnce(new Error("application state unavailable"))
      .mockResolvedValueOnce(true);

    await expect(handler({} as any)).rejects.toThrow(
      "application state unavailable",
    );
    expect(mockDeleteRecordingChunks).not.toHaveBeenCalled();

    mockSelectRows.rows[0]!.status = "failed";
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockCompareAndSetManyAppState).toHaveBeenCalledTimes(2);
    expect(mockDeleteRecordingChunks).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
      null,
    );
  });

  it("preserves the resumable session when provider abort cleanup fails", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Cancelled" });
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "upload-example",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 123,
    });
    mockAbortSession.mockRejectedValue(new Error("S3 unavailable"));
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual({
        ok: true,
        recordingId: "rec-1",
        chunksCleared: 2,
      });
    } finally {
      consoleWarn.mockRestore();
    }

    expect(mockAbortSession).toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
  });

  it("retries retained provider cleanup for an already-failed recording", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        videoUrl: null,
        failureReason: "Cancelled",
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Cancelled" });
    mockGetResumableSession.mockResolvedValue({
      providerId: "s3",
      sessionId: "upload-example",
      meta: { objectKey: "clips/rec-1.webm" },
      bytesUploaded: 123,
    });

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "upload-example",
      meta: { objectKey: "clips/rec-1.webm" },
    });
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1", null);
  });
});
