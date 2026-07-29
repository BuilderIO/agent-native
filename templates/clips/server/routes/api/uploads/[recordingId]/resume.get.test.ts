import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRenewUploadLease = vi.hoisted(() => vi.fn());
const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockListRecordingChunkKeys = vi.hoisted(() => vi.fn());
const mockSumRecordingChunkBytes = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
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
  getRouterParam: () => "rec-1",
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
}));

import handler from "./resume.get";

describe("/api/uploads/:recordingId/resume route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.rows = [{ id: "rec-1", status: "uploading" }];
    mockRenewUploadLease.mockResolvedValue({ held: true });
    mockGetResumableSession.mockResolvedValue(null);
    mockListRecordingChunkKeys.mockResolvedValue([]);
    mockSumRecordingChunkBytes.mockResolvedValue(0);
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
        bytesReceived: 4_194_304,
        nextChunkIndex: 4,
      }),
    );
    expect(mockRenewUploadLease).toHaveBeenCalledWith("rec-1");
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
        bytesReceived: 15,
        nextChunkIndex: 2,
      }),
    );
  });

  it("reports a terminal recording as not resumable", async () => {
    mockRenewUploadLease.mockResolvedValue({
      held: false,
      status: "failed",
      failureReason: "Upload aborted by user",
      videoUrl: null,
    });

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        resumable: false,
        status: "failed",
        failureReason: "Upload aborted by user",
      }),
    );
  });

  it("404s a recording the caller does not own", async () => {
    mockSelectRows.rows = [];

    await expect(handler({} as any)).resolves.toEqual({
      error: "Recording not found",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(mockRenewUploadLease).not.toHaveBeenCalled();
  });
});
