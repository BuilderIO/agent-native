import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  compareAndSetAppState: vi.fn(async () => true),
  readAppState: vi.fn(
    async (_key: string) => null as Record<string, unknown> | null,
  ),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mocks.compareAndSetAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

import updateAiRequestStatus from "./update-ai-request-status";

const identity = {
  recordingId: "rec_1",
  kind: "remove-filler-words",
  requestedAt: "2026-10-08T12:00:00.000Z",
  operationId:
    "clips-ai-request:rec_1:remove-filler-words:2026-10-08T12%3A00%3A00.000Z",
  threadId: "clips-thread",
  turnId: "background-turn-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAppState.mockResolvedValue({
    ...identity,
    status: "working",
  });
  mocks.compareAndSetAppState.mockResolvedValue(true);
  mocks.writeAppState.mockResolvedValue(undefined);
});

describe("update-ai-request-status background receipts", () => {
  it("records run-manager truncation as a terminal retryable status", async () => {
    const args = updateAiRequestStatus.schema.parse({
      ...identity,
      status: "truncated",
      runId: "run-truncated",
      message: "output limit reached",
    });

    await expect(updateAiRequestStatus.run(args)).resolves.toMatchObject({
      status: "truncated",
      cancelled: false,
    });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_1",
      expect.objectContaining({ status: "working" }),
      expect.objectContaining({
        status: "truncated",
        operationId: identity.operationId,
        threadId: identity.threadId,
        turnId: identity.turnId,
        runId: "run-truncated",
        message: "output limit reached",
      }),
    );
  });

  it("rejects a receipt update from a different operation identity", async () => {
    const current = {
      ...identity,
      status: "working",
      operationId: "newer-operation",
    };
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-request-status-rec_1" ? current : null,
    );
    const args = updateAiRequestStatus.schema.parse({
      ...identity,
      status: "completed",
    });

    await expect(updateAiRequestStatus.run(args)).rejects.toThrow("stale");
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("requires the queued request to match before claiming its background operation", async () => {
    mocks.readAppState
      .mockResolvedValueOnce({
        ...identity,
        status: "queued",
        operationId: undefined,
      })
      .mockResolvedValueOnce(null);
    const args = updateAiRequestStatus.schema.parse({
      ...identity,
      status: "working",
    });

    await expect(updateAiRequestStatus.run(args)).rejects.toThrow("stale");
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });
});
