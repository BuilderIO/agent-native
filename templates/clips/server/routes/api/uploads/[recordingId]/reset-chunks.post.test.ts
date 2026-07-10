import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockDeleteAppStateByPrefix = vi.hoisted(() => vi.fn());
const mockGetActiveFileUploadProviderForRequest = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetEventOwnerContext = vi.hoisted(() => vi.fn());
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockDeleteResumableSession = vi.hoisted(() => vi.fn());
const mockSetResumableSession = vi.hoisted(() => vi.fn());
const mockStartSession = vi.hoisted(() => vi.fn());
const mockShouldEnableStreamingUpload = vi.hoisted(() => vi.fn());
const mockAllowsSqlRecordingChunkScratch = vi.hoisted(() => vi.fn());
const mockUpdateSets = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(async () => [{ id: "rec-1" }]),
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
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
  deleteAppStateByPrefix: (...args: unknown[]) =>
    mockDeleteAppStateByPrefix(...args),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    mockGetActiveFileUploadProviderForRequest(...args),
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

vi.mock("../../../../lib/resumable-session.js", () => ({
  deleteResumableSession: (...args: unknown[]) =>
    mockDeleteResumableSession(...args),
  setResumableSession: (...args: unknown[]) => mockSetResumableSession(...args),
}));

vi.mock("../../../../lib/streaming-upload-mode.js", () => ({
  shouldEnableStreamingUpload: (...args: unknown[]) =>
    mockShouldEnableStreamingUpload(...args),
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
    mockGetRouterParam.mockReturnValue("rec-1");
    mockGetEventOwnerContext.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockDeleteAppStateByPrefix.mockResolvedValue(3);
    mockDeleteResumableSession.mockResolvedValue(undefined);
    mockSetResumableSession.mockResolvedValue(undefined);
    mockWriteAppState.mockResolvedValue(undefined);
    mockAllowsSqlRecordingChunkScratch.mockReturnValue(false);
    mockShouldEnableStreamingUpload.mockReturnValue(true);
    mockStartSession.mockResolvedValue({
      sessionId: "session-1",
      meta: { provider: "test" },
    });
    mockGetActiveFileUploadProviderForRequest.mockResolvedValue({
      id: "test-provider",
      resumable: { startSession: mockStartSession },
    });
  });

  it("recreates a resumable session for a browser backup retry", async () => {
    mockReadBody.mockResolvedValue({
      requestStreaming: true,
      mimeType: "video/webm;codecs=vp9,opus",
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        recordingId: "rec-1",
        uploadMode: "streaming",
        chunksCleared: 3,
      }),
    );

    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec-1");
    expect(mockStartSession).toHaveBeenCalledWith(
      "rec-1.webm",
      "video/webm",
      expect.any(Number),
    );
    expect(mockSetResumableSession).toHaveBeenCalledWith("rec-1", {
      providerId: "test-provider",
      sessionId: "session-1",
      meta: { provider: "test", stableUrl: true, recordAsset: false },
      bytesUploaded: 0,
      lastCommittedIndex: -1,
    });
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
});
