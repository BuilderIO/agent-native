import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockDeleteAppStateByPrefix = vi.hoisted(() => vi.fn());
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
  deleteAppStateByPrefix: (...args: unknown[]) =>
    mockDeleteAppStateByPrefix(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
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
    },
  },
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
    mockGetRouterParam.mockReturnValue("rec-1");
    mockReadBody.mockResolvedValue({
      reason: "Upload was stored-but-unservable: media URL timed out",
    });
    mockGetEventOwnerContext.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockDeleteAppStateByPrefix.mockResolvedValue(2);
    mockDeleteResumableSession.mockResolvedValue(undefined);
    mockGetResumableSession.mockResolvedValue(null);
    mockAbortSession.mockResolvedValue(undefined);
    mockResolveResumableUploadProvider.mockResolvedValue({
      resumable: { abortSession: mockAbortSession },
    });
    mockReadAppState.mockResolvedValue({
      recordingId: "rec-1",
      status: "uploading",
      mimeType: "video/mp4",
      durationMs: 1234,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasCamera: false,
    });
    mockWriteAppState.mockResolvedValue(undefined);
  });

  it("preserves buffered chunks after stored-but-unservable finalize failures", async () => {
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      chunksCleared: 0,
    });

    expect(mockDeleteAppStateByPrefix).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
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

    expect(mockDeleteAppStateByPrefix).toHaveBeenCalledWith(
      "recording-chunks-rec-1-",
    );
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1");
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
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1");
  });
});
