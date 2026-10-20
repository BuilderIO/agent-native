import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compareAndSetManyAppState: vi.fn(async () => true),
  readAppState: vi.fn(async () => null as Record<string, unknown> | null),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetManyAppState: mocks.compareAndSetManyAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

import {
  queueAiRequest,
  withAiRequestStatusInstructions,
} from "./ai-request-status";

describe("AI request status lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compareAndSetManyAppState.mockResolvedValue(true);
    mocks.readAppState.mockResolvedValue(null);
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  it("queues status before the request and tells the agent to close the lifecycle", async () => {
    const message = withAiRequestStatusInstructions({
      message: "Remove the filler words.",
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });

    await queueAiRequest({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      request: { kind: "remove-filler-words", message },
    });

    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      {
        key: "clips-ai-request-status-rec_123",
        expectedValue: null,
        nextValue: {
          kind: "remove-filler-words",
          status: "queued",
          message: null,
          requestedAt: "2026-09-04T12:00:00.000Z",
          updatedAt: "2026-09-04T12:00:00.000Z",
        },
      },
      {
        key: "clips-ai-request-rec_123",
        expectedValue: null,
        nextValue: expect.objectContaining({ message }),
      },
    ]);
    expect(mocks.writeAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
    expect(message).toContain("--status=working");
    expect(message).toContain("--status=completed");
    expect(message).toContain("--status=failed");
    expect(message).toContain('--requestedAt="2026-09-04T12:00:00.000Z"');
  });

  it("surfaces a failed atomic enqueue without replacing request status", async () => {
    mocks.compareAndSetManyAppState.mockRejectedValueOnce(
      new Error("request write failed"),
    );

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-silences",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "remove-silences" },
      }),
    ).rejects.toThrow("request write failed");

    expect(mocks.writeAppState).not.toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.anything(),
    );
  });

  it("does not let a generic request replace an active filler session status", async () => {
    const statusKey = "clips-ai-request-status-rec_123";
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === statusKey
        ? {
            kind: "remove-filler-words",
            status: "working",
            requestedAt: "2026-09-04T12:00:00.000Z",
            operationId: "active-operation",
          }
        : {
            kind: "remove-filler-words",
            recordingId: "rec_123",
            requestedAt: "2026-09-04T12:00:00.000Z",
          },
    );

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-summary",
        requestedAt: "2026-09-04T12:01:00.000Z",
        request: { kind: "regenerate-summary" },
      }),
    ).rejects.toThrow("A remove-filler-words request is already running");

    expect(mocks.compareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("keeps a durable request queued when the refresh signal fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.writeAppState.mockRejectedValueOnce(
      new Error("refresh write failed"),
    );

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-silences",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "remove-silences" },
      }),
    ).resolves.toBeUndefined();

    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledOnce();
    expect(mocks.writeAppState).toHaveBeenCalledOnce();
    expect(mocks.writeAppState).not.toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "failed" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[clips] failed to publish AI request refresh signal",
      expect.objectContaining({
        recordingId: "rec_123",
        kind: "remove-silences",
        error: expect.any(Error),
      }),
    );
    warn.mockRestore();
  });
});
