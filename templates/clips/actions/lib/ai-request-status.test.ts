import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mockWriteAppState,
}));

import {
  queueAiRequest,
  withAiRequestStatusInstructions,
} from "./ai-request-status";

describe("AI request status lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAppState.mockResolvedValue(undefined);
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

    expect(mockWriteAppState.mock.calls[0]).toEqual([
      "clips-ai-request-status-rec_123",
      expect.objectContaining({
        kind: "remove-filler-words",
        status: "queued",
      }),
    ]);
    expect(mockWriteAppState.mock.calls[1]).toEqual([
      "clips-ai-request-rec_123",
      expect.objectContaining({ message }),
    ]);
    expect(message).toContain("--status=working");
    expect(message).toContain("--status=completed");
    expect(message).toContain("--status=failed");
    expect(message).toContain('--requestedAt="2026-09-04T12:00:00.000Z"');
  });

  it("turns an enqueue failure into a visible failed status", async () => {
    mockWriteAppState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("request write failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-silences",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "remove-silences" },
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
});
