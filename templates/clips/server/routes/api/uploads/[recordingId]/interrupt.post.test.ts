import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetAppState = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockIsFeatureFlagEnabled = vi.hoisted(() => vi.fn());
const mockAbortUpload = vi.hoisted(() => vi.fn());
const mockSelectRows = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));
const mockUpdatedRows = vi.hoisted(() => ({ rows: [{ id: "rec-1" }] }));
const mockUpdateSets = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockBody = vi.hoisted(() => ({
  value: { detail: "TypeError: Load failed" } as Record<string, unknown>,
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
      returning: vi.fn(async () => mockUpdatedRows.rows),
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
  readBody: async () => mockBody.value,
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
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
vi.mock("./abort.post.js", () => ({
  default: (...args: unknown[]) => mockAbortUpload(...args),
}));

import handler from "./interrupt.post";

describe("/api/uploads/:recordingId/interrupt route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        failureReason: null,
        videoUrl: null,
      },
    ];
    mockUpdatedRows.rows = [{ id: "rec-1" }];
    mockBody.value = { detail: "TypeError: Load failed" };
    mockUpdateSets.length = 0;
    mockReadAppState.mockResolvedValue({
      recordingId: "rec-1",
      bytesReceived: 7_864_320,
      progress: 40,
    });
    mockWriteAppState.mockResolvedValue(undefined);
    mockCompareAndSetAppState.mockResolvedValue(true);
    mockIsFeatureFlagEnabled.mockResolvedValue(true);
    mockAbortUpload.mockResolvedValue({ ok: true, legacyAbort: true });
  });

  it("uses the existing destructive abort when resumable retry is disabled", async () => {
    mockIsFeatureFlagEnabled.mockResolvedValue(false);

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      legacyAbort: true,
    });
    expect(mockAbortUpload).toHaveBeenCalledOnce();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("marks the row retryable without deleting resumable state", async () => {
    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      status: "failed",
      resumable: true,
    });
    expect(mockUpdateSets).toEqual([
      expect.objectContaining({
        status: "failed",
        failureReason:
          "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.",
      }),
    ]);
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "recording-upload-rec-1",
      expect.objectContaining({ bytesReceived: 7_864_320 }),
      expect.objectContaining({
        status: "failed",
        retryableInterruption: true,
        bytesReceived: 7_864_320,
        interruptionDetail: "TypeError: Load failed",
      }),
    );
  });

  it("does not overwrite media that the server already accepted", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "processing",
        failureReason: null,
        videoUrl: "https://cdn.example.com/rec-1",
      },
    ];

    await expect(handler({} as any)).resolves.toEqual({
      ok: true,
      recordingId: "rec-1",
      status: "processing",
      alreadyAccepted: true,
    });
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("rejects a lost compare-and-set instead of claiming interruption", async () => {
    mockUpdatedRows.rows = [];

    await expect(handler({} as any)).resolves.toEqual({
      error: "Recording upload changed while it was interrupted",
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

  it("preserves replacement upload state after the row claim", async () => {
    mockCompareAndSetAppState.mockResolvedValue(false);
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      await expect(handler({} as any)).resolves.toEqual(
        expect.objectContaining({ ok: true, resumable: true }),
      );
    } finally {
      consoleInfo.mockRestore();
    }

    expect(mockCompareAndSetAppState).toHaveBeenCalledOnce();
    expect(mockWriteAppState).toHaveBeenCalledTimes(1);
    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("retries auxiliary reconciliation for an already interrupted row", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "failed",
        failureReason:
          "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.",
        uploadAttemptId: null,
        uploadGenerationId: null,
      },
    ];

    await expect(handler({} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        alreadyInterrupted: true,
        resumable: true,
      }),
    );

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockCompareAndSetAppState).toHaveBeenCalledOnce();
  });

  it("does not let a delayed callback interrupt a newer retry", async () => {
    mockSelectRows.rows = [
      {
        id: "rec-1",
        status: "uploading",
        failureReason: null,
        uploadAttemptId: "new-attempt",
      },
    ];

    await expect(handler({} as any)).resolves.toEqual({
      error: "A newer upload retry is already active.",
      staleAttempt: true,
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 409);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
