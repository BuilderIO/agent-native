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

import { queueBackgroundAiRequest } from "./ai-request-status";

const requestedAt = "2026-10-08T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAppState.mockResolvedValue(null);
  mocks.compareAndSetManyAppState.mockResolvedValue(true);
  mocks.writeAppState.mockResolvedValue(undefined);
});

describe("queueBackgroundAiRequest", () => {
  it("writes status and request atomically", async () => {
    const request = {
      kind: "remove-filler-words",
      recordingId: "rec_1",
      requestedAt,
    };

    await queueBackgroundAiRequest({
      recordingId: "rec_1",
      kind: "remove-filler-words",
      requestedAt,
      request,
    });

    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      {
        key: "clips-ai-request-status-rec_1",
        expectedValue: null,
        nextValue: {
          kind: "remove-filler-words",
          status: "queued",
          message: null,
          requestedAt,
          updatedAt: requestedAt,
        },
      },
      {
        key: "clips-ai-request-rec_1",
        expectedValue: null,
        nextValue: request,
      },
    ]);
    expect(mocks.writeAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("rejects a second active cleanup without replacing its queued request", async () => {
    mocks.readAppState
      .mockResolvedValueOnce({
        kind: "remove-filler-words",
        status: "working",
        requestedAt: "2026-10-08T11:59:59.000Z",
      })
      .mockResolvedValueOnce({
        kind: "remove-filler-words",
        recordingId: "rec_1",
        requestedAt: "2026-10-08T11:59:59.000Z",
      });

    await expect(
      queueBackgroundAiRequest({
        recordingId: "rec_1",
        kind: "remove-filler-words",
        requestedAt,
        request: {
          kind: "remove-filler-words",
          recordingId: "rec_1",
          requestedAt,
        },
      }),
    ).rejects.toThrow("already running");
    expect(mocks.compareAndSetManyAppState).not.toHaveBeenCalled();
  });

  it("retries a compare-and-set race against the latest slot values", async () => {
    mocks.compareAndSetManyAppState
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await queueBackgroundAiRequest({
      recordingId: "rec_1",
      kind: "remove-filler-words",
      requestedAt,
      request: {
        kind: "remove-filler-words",
        recordingId: "rec_1",
        requestedAt,
      },
    });

    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledTimes(2);
  });
});
