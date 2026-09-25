import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCompareAndSetAppState = vi.hoisted(() => vi.fn(async () => true));
const mockReadAppState = vi.hoisted(() => vi.fn(async () => null));
const mockAssertAccess = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mockCompareAndSetAppState,
  readAppState: mockReadAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mockAssertAccess,
}));

import action from "./update-ai-request-status";

describe("update-ai-request-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAppState.mockResolvedValue(null);
    mockCompareAndSetAppState.mockResolvedValue(true);
  });

  it("writes a scoped completion status for queued silence removal", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-silences",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-silences",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "completed",
      message: "Removed 2 silent ranges.",
    });

    await expect(action.run(args)).resolves.toMatchObject({
      recordingId: "rec_123",
      status: "completed",
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "editor",
    );
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "working" }),
      expect.objectContaining({
        kind: "remove-silences",
        status: "completed",
        message: "Removed 2 silent ranges.",
      }),
    );
  });

  it("supports filler-word progress and preserves the request timestamp", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "queued",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "working",
    });

    await action.run(args);

    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "queued" }),
      expect.objectContaining({
        kind: "remove-filler-words",
        status: "working",
        requestedAt: "2026-09-04T12:00:00.000Z",
      }),
    );
  });

  it("records cancellation for the matching active request", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "regenerate-chapters",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "regenerate-chapters",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "cancelled",
    });

    await expect(action.run(args)).resolves.toMatchObject({
      recordingId: "rec_123",
      kind: "regenerate-chapters",
      status: "cancelled",
      cancelled: true,
    });
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "working" }),
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("does not overwrite an already completed request with cancellation", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "regenerate-chapters",
      status: "completed",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "regenerate-chapters",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "cancelled",
    });

    await expect(action.run(args)).resolves.toMatchObject({
      status: "completed",
      cancelled: false,
    });
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
  });

  it("rejects a stale update for a different active request", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-silences",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "completed",
    });

    await expect(action.run(args)).rejects.toThrow(
      "remove-silences is the active request",
    );
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
  });

  it("rejects an update from an older run of the same request kind", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-silences",
      status: "working",
      requestedAt: "2026-09-04T12:01:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-silences",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "completed",
    });

    await expect(action.run(args)).rejects.toThrow("stale");
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not let a cancellation overwrite a concurrent completion", async () => {
    const working = {
      kind: "regenerate-chapters",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
      updatedAt: "2026-09-04T12:00:01.000Z",
    };
    mockReadAppState
      .mockResolvedValueOnce(working)
      .mockResolvedValueOnce({ ...working, status: "completed" });
    mockCompareAndSetAppState.mockResolvedValue(false);
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "regenerate-chapters",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "cancelled",
    });

    await expect(action.run(args)).resolves.toMatchObject({
      status: "completed",
      cancelled: false,
    });
    expect(mockCompareAndSetAppState).toHaveBeenCalledTimes(1);
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      working,
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it.each(["cancelled", "failed"] as const)(
    "retries a terminal %s after a same-request progress update",
    async (status) => {
      const working = {
        kind: "regenerate-chapters",
        status: "working",
        requestedAt: "2026-09-04T12:00:00.000Z",
        updatedAt: "2026-09-04T12:00:01.000Z",
      };
      const newerWorking = {
        ...working,
        updatedAt: "2026-09-04T12:00:02.000Z",
      };
      mockReadAppState
        .mockResolvedValueOnce(working)
        .mockResolvedValueOnce(newerWorking);
      mockCompareAndSetAppState
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const args = action.schema.parse({
        recordingId: "rec_123",
        kind: "regenerate-chapters",
        requestedAt: "2026-09-04T12:00:00.000Z",
        status,
      });

      await expect(action.run(args)).resolves.toMatchObject({
        status,
        cancelled: status === "cancelled",
      });
      expect(mockCompareAndSetAppState).toHaveBeenCalledTimes(2);
      expect(mockCompareAndSetAppState).toHaveBeenLastCalledWith(
        "clips-ai-request-status-rec_123",
        newerWorking,
        expect.objectContaining({ status }),
      );
    },
  );

  it("bounds retries when the request keeps changing", async () => {
    const working = {
      kind: "regenerate-chapters",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    };
    mockReadAppState
      .mockResolvedValueOnce(working)
      .mockResolvedValueOnce({ ...working, updatedAt: "1" })
      .mockResolvedValueOnce({ ...working, updatedAt: "2" })
      .mockResolvedValueOnce({ ...working, updatedAt: "3" });
    mockCompareAndSetAppState.mockResolvedValue(false);
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "regenerate-chapters",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "cancelled",
    });

    await expect(action.run(args)).rejects.toThrow("changed before the update");
    expect(mockCompareAndSetAppState).toHaveBeenCalledTimes(3);
  });

  it("does not regress a terminal request back to working", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "completed",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "working",
    });

    await expect(action.run(args)).rejects.toThrow("already completed");
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
  });
});
