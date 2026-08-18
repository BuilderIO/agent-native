import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCapture: vi.fn(),
  enqueueCaptureDistillation: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("../server/lib/brain.js", () => ({
  BrainCaptureBlockedError: class BrainCaptureBlockedError extends Error {},
  createCapture: mocks.createCapture,
  ensureManualSource: vi.fn(),
  serializeCapture: (capture: unknown) => capture,
  serializeSource: (source: unknown) => source,
}));

vi.mock("../server/lib/distillation-queue.js", () => ({
  enqueueCaptureDistillation: mocks.enqueueCaptureDistillation,
}));

import action from "./import-capture.js";

const baseArgs = {
  sourceId: "source-1",
  title: "Product FAQ",
  kind: "document" as const,
  content: "Agent Native is an application framework.",
  enqueueDistillation: true,
};

describe("import-capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCapture.mockResolvedValue({
      id: "capture-1",
      sourceId: "source-1",
      status: "queued",
      updatedAt: "2026-07-30T10:00:00.000Z",
    });
    mocks.enqueueCaptureDistillation.mockResolvedValue({
      queueItem: {
        id: "queue-1",
        updatedAt: "2026-07-30T10:01:00.000Z",
      },
      existing: false,
      guidance: {},
    });
  });

  it("queues distillation and returns the queue handoff", async () => {
    const result = await action.run(baseArgs);

    expect(mocks.enqueueCaptureDistillation).toHaveBeenCalledWith({
      capture: expect.objectContaining({ id: "capture-1" }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        capture: expect.objectContaining({
          id: "capture-1",
          status: "distilling",
          updatedAt: "2026-07-30T10:01:00.000Z",
        }),
        distillation: expect.objectContaining({
          existing: false,
          queueItem: expect.objectContaining({ id: "queue-1" }),
        }),
      }),
    );
    expect(result).not.toHaveProperty("nextAction");
  });

  it("does not queue distillation when explicitly disabled", async () => {
    const result = await action.run({
      ...baseArgs,
      enqueueDistillation: false,
    });

    expect(mocks.enqueueCaptureDistillation).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        capture: expect.objectContaining({
          id: "capture-1",
          status: "queued",
          updatedAt: "2026-07-30T10:00:00.000Z",
        }),
        distillation: undefined,
      }),
    );
  });
});
