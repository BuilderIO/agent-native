import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetManyAppState = vi.hoisted(() => vi.fn());
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
const mockUpdateRows = vi.hoisted(() => ({ rows: [{ id: "rec-1" }] }));
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
        status: "failed",
        videoUrl: null,
        failureReason: "Upload was stored-but-unservable: media URL timed out",
      },
    ];
    mockUpdateSets.length = 0;
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

  it("keeps a recorded failure reason when a teardown abort sends none", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        videoUrl: null,
        failureReason: "Upload failed (413): payload too large",
      },
    ];
    mockReadBody.mockResolvedValue({});

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 2,
    });

    expect(mockUpdateSets).toEqual([
      expect.objectContaining({
        status: "failed",
        failureReason: "Upload failed (413): payload too large",
      }),
    ]);
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "recording-upload-rec-1",
        nextValue: expect.objectContaining({
          failureReason: "Upload failed (413): payload too large",
        }),
      }),
    ]);
  });

  it("records an explicit abort reason over an earlier failure", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        videoUrl: null,
        failureReason: "Upload failed (413): payload too large",
      },
    ];
    mockReadBody.mockResolvedValue({ reason: "Recording cancelled by user" });

    await handler({} as any);

    expect(mockUpdateSets).toEqual([
      expect.objectContaining({
        failureReason: "Recording cancelled by user",
      }),
    ]);
  });

  it("falls back to the generic reason when nothing was recorded yet", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        videoUrl: null,
        failureReason: null,
      },
    ];
    mockReadBody.mockResolvedValue({});

    await handler({} as any);

    expect(mockUpdateSets).toEqual([
      expect.objectContaining({ failureReason: "Upload aborted by user" }),
    ]);
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
      .mockResolvedValueOnce(null);
    mockCompareAndSetManyAppState.mockResolvedValue(false);
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

    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
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
    expect(mockWriteAppState).toHaveBeenCalledTimes(1);
    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("surfaces auxiliary-state failures after claiming the abort", async () => {
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
