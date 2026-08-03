import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRenewUploadLease = vi.hoisted(() => vi.fn());
const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockListRecordingChunkKeys = vi.hoisted(() => vi.fn());
const mockSumRecordingChunkBytes = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetAppState = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockIsFeatureFlagEnabled = vi.hoisted(() => vi.fn());
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
      set: vi.fn(() => builder),
      where: vi.fn(() => builder),
      returning: vi.fn(async () => mockUpdateRows.rows),
    };
    return builder;
  }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: (...args: unknown[]) =>
    mockCompareAndSetAppState(...args),
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

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  isNull: vi.fn(() => "is-null"),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: () => "rec-1",
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseHeader: vi.fn(),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../../../../db/index.js", () => ({
  getDb: () => mockDb,
  schema: { recordings: {} },
}));

vi.mock("../../../../lib/recordings.js", () => ({
  getEventOwnerContext: async () => ({
    userEmail: "owner@example.com",
    orgId: "org-1",
  }),
  ownerEmailMatches: () => "owner-match",
}));

vi.mock("../../../../lib/recording-upload-state.js", () => ({
  listRecordingChunkKeys: (...args: unknown[]) =>
    mockListRecordingChunkKeys(...args),
  recordingChunkIndexFromKey: (key: string) => {
    const raw = key.slice(key.lastIndexOf("-") + 1);
    return /^\d+$/.test(raw) ? Number(raw) : null;
  },
  sumRecordingChunkBytes: (...args: unknown[]) =>
    mockSumRecordingChunkBytes(...args),
}));

vi.mock("../../../../lib/resumable-session.js", () => ({
  getResumableSession: (...args: unknown[]) => mockGetResumableSession(...args),
}));

vi.mock("../../../../lib/upload-lease.js", () => ({
  renewUploadLease: (...args: unknown[]) => mockRenewUploadLease(...args),
  uploadLeaseExpiry: () => "2099-01-01T00:00:00.000Z",
}));

import handler from "./resume.get";

describe("/api/uploads/:recordingId/resume route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.rows = [{ id: "rec-1", status: "uploading" }];
    mockGetQuery.mockReturnValue({ attemptId: "client-attempt-0001" });
    mockRenewUploadLease.mockResolvedValue({ held: true });
    mockGetResumableSession.mockResolvedValue(null);
    mockListRecordingChunkKeys.mockResolvedValue([]);
    mockSumRecordingChunkBytes.mockResolvedValue(0);
    mockReadAppState.mockResolvedValue({ progress: 50 });
    mockWriteAppState.mockResolvedValue(undefined);
    mockCompareAndSetAppState.mockResolvedValue(true);
    mockUpdateRows.rows = [{ id: "rec-1" }];
    mockIsFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("leaves upload state untouched when resumable retry is disabled", async () => {
    mockIsFeatureFlagEnabled.mockResolvedValue(false);

    await expect(handler({} as any)).resolves.toEqual({
      recoveryEnabled: false,
      resumable: false,
      recordingId: "rec-1",
      status: null,
      reason: "feature_disabled",
    });
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("reports the provider's committed offset for a streaming upload", async () => {
    mockGetResumableSession.mockResolvedValue({
      bytesUploaded: 4_194_304,
      lastCommittedIndex: 3,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: true,
        uploadMode: "streaming",
        attemptId: "client-attempt-0001",
        bytesReceived: 4_194_304,
        nextChunkIndex: 4,
      }),
    );
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("resumes a buffered upload at the first gap, not after the highest index", async () => {
    mockListRecordingChunkKeys.mockResolvedValue([
      "recording-chunks-rec-1-000000",
      "recording-chunks-rec-1-000001",
      "recording-chunks-rec-1-000004",
    ]);
    mockSumRecordingChunkBytes.mockResolvedValue(15);

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: true,
        uploadMode: "buffered",
        attemptId: "client-attempt-0001",
        bytesReceived: 15,
        nextChunkIndex: 2,
      }),
    );
  });

  it("reports a terminal recording as not resumable", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        failureReason: "Upload aborted by user",
        videoUrl: null,
      },
    ];

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: false,
        status: "failed",
        failureReason: "Upload aborted by user",
      }),
    );
  });

  it("atomically reclaims an interrupted upload with its existing session", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        failureReason:
          "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.",
        uploadProgress: 40,
      },
    ];
    mockGetResumableSession.mockResolvedValue({
      bytesUploaded: 7_864_320,
      lastCommittedIndex: 1,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: true,
        status: "uploading",
        bytesReceived: 7_864_320,
        nextChunkIndex: 2,
      }),
    );
    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "recording-upload-rec-1",
      expect.objectContaining({ progress: 50 }),
      expect.objectContaining({
        status: "uploading",
        progress: 40,
        bytesReceived: 7_864_320,
        retryableInterruption: false,
      }),
    );
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("claims a restart token when the prior provider session is gone", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        failureReason:
          "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.",
      },
    ];

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: true,
        status: "uploading",
        uploadMode: "buffered",
        attemptId: "client-attempt-0001",
      }),
    );
    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockRenewUploadLease).not.toHaveBeenCalled();
  });

  it("fences a concurrent retry that lost the writer-token claim", async () => {
    mockUpdateRows.rows = [];

    await expect(handler({} as any)).resolves.toEqual({
      resumable: false,
      recoveryEnabled: true,
      recordingId: "rec-1",
      status: "uploading",
      reason: "retry_already_active",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("fails before claiming the row when upload state is unreadable", async () => {
    mockReadAppState.mockRejectedValue(new Error("state store unavailable"));

    await expect(handler({} as any)).rejects.toThrow("state store unavailable");

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("does not return a stale resume plan when interruption wins publication", async () => {
    mockCompareAndSetAppState.mockImplementation(async () => {
      mockSelectRows.rows = [
        {
          id: "rec-1",
          status: "failed",
          uploadAttemptId: "client-attempt-0001",
          uploadGenerationId: null,
        },
      ];
      return false;
    });

    await expect(handler({} as any)).resolves.toEqual({
      resumable: false,
      recoveryEnabled: true,
      recordingId: "rec-1",
      status: "failed",
      reason: "upload_state_changed",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("preserves newer progress published by the same active claim", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        uploadAttemptId: "client-attempt-0001",
        uploadGenerationId: null,
      },
    ];
    mockCompareAndSetAppState.mockResolvedValue(false);
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual(
        expect.objectContaining({ resumable: true, status: "uploading" }),
      );
    } finally {
      consoleInfo.mockRestore();
    }

    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("does not let a different claim steal an active retry", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        uploadAttemptId: "active-attempt-0001",
      },
    ];

    await expect(handler({} as any)).resolves.toEqual({
      resumable: false,
      recoveryEnabled: true,
      recordingId: "rec-1",
      status: "uploading",
      reason: "retry_already_active",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("lets the same claim re-read its offset after a lost response", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        uploadAttemptId: "client-attempt-0001",
      },
    ];
    mockGetResumableSession.mockResolvedValue({
      bytesUploaded: 3_932_160,
      lastCommittedIndex: 0,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: true,
        attemptId: "client-attempt-0001",
        bytesReceived: 3_932_160,
        nextChunkIndex: 1,
      }),
    );
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("404s a recording the caller does not own", async () => {
    mockSelectRows.rows = [];

    await expect(handler({} as any)).resolves.toEqual({
      error: "Recording not found",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(mockRenewUploadLease).not.toHaveBeenCalled();
  });

  it("rejects a retry claim the client cannot safely reuse", async () => {
    mockGetQuery.mockReturnValue({ attemptId: "short" });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "A valid upload retry attemptId is required",
    });
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
