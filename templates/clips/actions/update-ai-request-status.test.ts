import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCompareAndSetAppState = vi.hoisted(() => vi.fn(async () => true));
const mockCompareAndSetManyAppState = vi.hoisted(() => vi.fn(async () => true));
const mockReadAppState = vi.hoisted(() =>
  vi.fn(async (_key: string): Promise<Record<string, unknown> | null> => null),
);
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockAssertAccess = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mockCompareAndSetAppState,
  compareAndSetManyAppState: mockCompareAndSetManyAppState,
  readAppState: mockReadAppState,
  writeAppState: mockWriteAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mockAssertAccess,
}));

import action from "./update-ai-request-status";

describe("update-ai-request-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAppState.mockReset();
    mockReadAppState.mockResolvedValue(null);
    mockCompareAndSetManyAppState.mockResolvedValue(true);
    mockCompareAndSetAppState.mockResolvedValue(true);
    mockWriteAppState.mockResolvedValue(undefined);
  });

  it.each(["failed", "truncated", "cancelled"] as const)(
    "atomically remembers unsuccessful title outcome %s",
    async (status) => {
      const current = {
        kind: "generate-metadata",
        status: "working",
        requestedAt: "2026-09-04T12:00:00.000Z",
      };
      mockReadAppState.mockImplementation(async (key: string) =>
        key === "clips-ai-request-status-rec_123" ? current : null,
      );
      await action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: "generate-metadata",
          requestedAt: current.requestedAt,
          status,
        }),
      );
      expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
        expect.objectContaining({
          key: "clips-ai-request-status-rec_123",
          expectedValue: current,
          nextValue: expect.objectContaining({ status }),
        }),
        expect.objectContaining({
          key: "clips-ai-title-terminal-rec_123",
          expectedValue: null,
          nextValue: expect.objectContaining({ status }),
        }),
      ]);
    },
  );

  it("records the revision used by a failed title request", async () => {
    const current = {
      kind: "generate-metadata",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
      transcriptRevision: "old-revision",
    };
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-request-status-rec_123" ? current : null,
    );
    await action.run(
      action.schema.parse({
        recordingId: "rec_123",
        kind: "generate-metadata",
        requestedAt: current.requestedAt,
        status: "failed",
      }),
    );
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({ expectedValue: current }),
      expect.objectContaining({
        nextValue: expect.objectContaining({
          suppressed: true,
          transcriptRevision: "old-revision",
        }),
      }),
    ]);
  });

  it("does not mark a stale title failure", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:01:00.000Z",
    });
    await expect(
      action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: "regenerate-title",
          requestedAt: "2026-09-04T12:00:00.000Z",
          status: "failed",
        }),
      ),
    ).rejects.toThrow("stale");
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
  });

  it("rejects an old operation even when the queued request still matches", async () => {
    const current = {
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
      operationId: "new-operation",
    };
    mockReadAppState.mockResolvedValue(current);
    await expect(
      action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: current.kind,
          requestedAt: current.requestedAt,
          operationId: "old-operation",
          status: "failed",
        }),
      ),
    ).rejects.toThrow("stale");
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
  });

  it("does not mark a title cancellation that loses to completion", async () => {
    const current = {
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    };
    let completed = false;
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-request-status-rec_123"
        ? { ...current, status: completed ? "completed" : "working" }
        : null,
    );
    mockCompareAndSetManyAppState.mockImplementationOnce(async () => {
      completed = true;
      return false;
    });
    await expect(
      action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: "regenerate-title",
          requestedAt: current.requestedAt,
          status: "cancelled",
        }),
      ),
    ).resolves.toMatchObject({ status: "completed", cancelled: false });
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledOnce();
  });

  it("retries the atomic title failure after same-request progress changes", async () => {
    const current = {
      kind: "generate-metadata",
      status: "queued",
      requestedAt: "2026-09-04T12:00:00.000Z",
    };
    const progress = { ...current, status: "working", runId: "run-1" };
    let advanced = false;
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-request-status-rec_123"
        ? advanced
          ? progress
          : current
        : null,
    );
    mockCompareAndSetManyAppState
      .mockImplementationOnce(async () => {
        advanced = true;
        return false;
      })
      .mockResolvedValueOnce(true);
    await expect(
      action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: "generate-metadata",
          requestedAt: current.requestedAt,
          status: "failed",
        }),
      ),
    ).resolves.toMatchObject({ status: "failed" });
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledTimes(2);
    expect(mockCompareAndSetManyAppState).toHaveBeenLastCalledWith([
      expect.objectContaining({
        key: "clips-ai-request-status-rec_123",
        expectedValue: progress,
        nextValue: expect.objectContaining({
          status: "failed",
          runId: "run-1",
        }),
      }),
      expect.objectContaining({
        key: "clips-ai-title-terminal-rec_123",
        nextValue: expect.objectContaining({
          status: "failed",
          suppressed: true,
        }),
      }),
    ]);
  });

  it("does not mark a failure that loses to a newer request", async () => {
    const current = {
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    };
    let replaced = false;
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-request-status-rec_123"
        ? replaced
          ? { ...current, requestedAt: "2026-09-04T12:01:00.000Z" }
          : current
        : null,
    );
    mockCompareAndSetManyAppState.mockImplementationOnce(async () => {
      replaced = true;
      return false;
    });
    await expect(
      action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: "regenerate-title",
          requestedAt: current.requestedAt,
          status: "failed",
        }),
      ),
    ).rejects.toThrow("changed before the update");
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledOnce();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("keeps a failure marker when an agent run completes without proof of a title write", async () => {
    const current = {
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    };
    const marker = {
      suppressed: true,
      status: "failed",
      requestedAt: "2026-09-04T11:00:00.000Z",
    };
    mockReadAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-request-status-rec_123" ? current : marker,
    );
    await action.run(
      action.schema.parse({
        recordingId: "rec_123",
        kind: "regenerate-title",
        requestedAt: current.requestedAt,
        status: "completed",
      }),
    );
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      current,
      expect.objectContaining({ status: "completed" }),
    );
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
  });

  it("does not clear a marker for a stale title completion", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:01:00.000Z",
    });
    await expect(
      action.run(
        action.schema.parse({
          recordingId: "rec_123",
          kind: "regenerate-title",
          requestedAt: "2026-09-04T12:00:00.000Z",
          status: "completed",
        }),
      ),
    ).rejects.toThrow("stale");
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
  });

  it("does not create a failure marker on title completion", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "regenerate-title",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    await action.run(
      action.schema.parse({
        recordingId: "rec_123",
        kind: "regenerate-title",
        requestedAt: "2026-09-04T12:00:00.000Z",
        status: "completed",
      }),
    );
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
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

  it("persists filler-word run ids with progress and preserves the request timestamp", async () => {
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
      runId: "run-1",
    });

    await action.run(args);

    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "queued" }),
      expect.objectContaining({
        kind: "remove-filler-words",
        status: "working",
        requestedAt: "2026-09-04T12:00:00.000Z",
        runId: "run-1",
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
