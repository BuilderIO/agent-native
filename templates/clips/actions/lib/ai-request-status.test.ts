import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockReadAppState = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, unknown> | null> => null),
);
const mockCompareAndSetAppState = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mockWriteAppState,
  readAppState: mockReadAppState,
  compareAndSetAppState: mockCompareAndSetAppState,
}));

import {
  queueAiRequest,
  settleAiRequestStatus,
  withAiRequestStatusInstructions,
} from "./ai-request-status";

const requestedAt = "2026-09-04T12:00:00.000Z";

describe("AI request status lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAppState.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue(null);
    mockCompareAndSetAppState.mockResolvedValue(true);
  });

  it("queues status before the request and tells the agent to close the lifecycle", async () => {
    const message = withAiRequestStatusInstructions({
      message: "Remove the filler words.",
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt,
    });

    await queueAiRequest({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt,
      request: { kind: "remove-filler-words", message },
    });

    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      null,
      expect.objectContaining({
        kind: "remove-filler-words",
        status: "queued",
      }),
    );
    expect(mockWriteAppState.mock.calls[0]).toEqual([
      "clips-ai-request-rec_123",
      expect.objectContaining({ message }),
    ]);
    expect(message).toContain("--status=working");
    expect(message).toContain("--status=completed");
    expect(message).toContain("--status=failed");
    expect(message).toContain(`--requestedAt="${requestedAt}"`);
  });

  it("refuses to overwrite a request that is still running", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "regenerate-summary",
      status: "working",
      requestedAt,
      updatedAt: new Date().toISOString(),
    });

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-filler-words",
        requestedAt: new Date().toISOString(),
        request: { kind: "remove-filler-words" },
      }),
    ).rejects.toMatchObject({ errorCode: "request_busy" });
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("replaces a request that stalled in the queue", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "queued",
      requestedAt,
      updatedAt: requestedAt,
    });

    await queueAiRequest({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: new Date().toISOString(),
      request: { kind: "remove-filler-words" },
    });

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_123",
      { kind: "remove-filler-words" },
    );
  });

  it("loses a concurrent queue race as busy instead of overwriting", async () => {
    mockCompareAndSetAppState.mockResolvedValue(false);

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-filler-words",
        requestedAt,
        request: { kind: "remove-filler-words" },
      }),
    ).rejects.toMatchObject({ errorCode: "request_busy" });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("turns an enqueue failure into a visible failed status", async () => {
    mockWriteAppState
      .mockRejectedValueOnce(new Error("request write failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-chapters",
        requestedAt,
        request: { kind: "regenerate-chapters" },
      }),
    ).rejects.toThrow("request write failed");

    expect(mockWriteAppState).toHaveBeenLastCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({
        status: "failed",
        message: "request write failed",
      }),
    );
  });

  it("keeps a durable request queued when the refresh signal fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockWriteAppState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("refresh write failed"));

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-chapters",
        requestedAt,
        request: { kind: "regenerate-chapters" },
      }),
    ).resolves.toBeUndefined();

    expect(mockWriteAppState).toHaveBeenCalledTimes(2);
    expect(mockWriteAppState).not.toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "failed" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[clips] failed to publish AI request refresh signal",
      expect.objectContaining({
        recordingId: "rec_123",
        kind: "regenerate-chapters",
        error: expect.any(Error),
      }),
    );
    warn.mockRestore();
  });
});

describe("settleAiRequestStatus", () => {
  const identity = {
    recordingId: "rec_123",
    kind: "remove-filler-words" as const,
    requestedAt,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompareAndSetAppState.mockResolvedValue(true);
  });

  it("settles the same request while it is still working", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "working",
      requestedAt,
    });

    await expect(
      settleAiRequestStatus(identity, "failed", "Run stopped"),
    ).resolves.toBe(true);
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "working" }),
      expect.objectContaining({ status: "failed", message: "Run stopped" }),
    );
  });

  it("never overwrites a result the agent already reported", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "completed",
      requestedAt,
    });

    await expect(
      settleAiRequestStatus(identity, "failed", "Run stopped"),
    ).resolves.toBe(false);
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
  });

  it("never settles a newer request", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "working",
      requestedAt: "2026-09-04T13:00:00.000Z",
    });

    await expect(
      settleAiRequestStatus(identity, "cancelled", null),
    ).resolves.toBe(false);
  });
});
