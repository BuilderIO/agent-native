import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  nanoid: vi.fn(),
  nowIso: vi.fn(),
  readBrainAgentGuidance: vi.fn(),
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...values: unknown[]) => values),
  inArray: vi.fn((...values: unknown[]) => values),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.insertValues }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: mocks.selectLimit }),
        }),
      }),
    }),
    update: () => ({ set: mocks.updateSet }),
  }),
  schema: {
    brainIngestQueue: {
      captureId: "captureId",
      operation: "operation",
      status: "status",
      updatedAt: "updatedAt",
    },
    brainRawCaptures: {
      id: "id",
    },
  },
}));

vi.mock("./brain.js", () => ({
  nanoid: mocks.nanoid,
  nowIso: mocks.nowIso,
  parseJson: (value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  readBrainAgentGuidance: mocks.readBrainAgentGuidance,
  serializeDistillationQueue: (row: unknown) => row,
  stableJson: (value: unknown) => JSON.stringify(value),
}));

import { enqueueCaptureDistillation } from "./distillation-queue.js";

const guidance = {
  identity: { companyName: "Example Co" },
  distillation: { instructions: "Keep durable facts." },
};

const capture = {
  id: "capture-1",
  sourceId: "source-1",
  status: "queued",
};

describe("enqueueCaptureDistillation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.nanoid.mockReturnValue("queue-1");
    mocks.nowIso.mockReturnValue("2026-07-30T10:00:00.000Z");
    mocks.readBrainAgentGuidance.mockResolvedValue({ guidance });
    mocks.selectLimit.mockResolvedValue([]);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  it("creates a queue row, marks the capture distilling, and writes the agent handoff", async () => {
    const result = await enqueueCaptureDistillation({
      capture: capture as never,
      priority: 70,
      instructions: "Prefer product definitions.",
      payload: { trigger: "import" },
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "queue-1",
        sourceId: "source-1",
        captureId: "capture-1",
        operation: "distill",
        status: "queued",
        priority: 70,
        payloadJson: JSON.stringify({
          trigger: "import",
          instructions: "Prefer product definitions.",
        }),
      }),
    );
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "distilling",
      updatedAt: "2026-07-30T10:00:00.000Z",
    });
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "brain-distill-request-capture-1",
      expect.objectContaining({
        captureId: "capture-1",
        queueId: "queue-1",
        instructions: "Prefer product definitions.",
        guidance,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        existing: false,
        queueItem: expect.objectContaining({
          id: "queue-1",
          status: "queued",
        }),
        guidance: guidance.distillation,
      }),
    );
  });

  it("reuses an active queue item and preserves its instructions", async () => {
    mocks.selectLimit.mockResolvedValue([
      {
        id: "queue-existing",
        sourceId: "source-1",
        captureId: "capture-1",
        status: "queued",
        priority: 50,
        attempts: 0,
        payloadJson: JSON.stringify({ instructions: "Existing guidance." }),
        error: null,
        runAfter: null,
        createdAt: "2026-07-30T09:00:00.000Z",
        updatedAt: "2026-07-30T09:00:00.000Z",
      },
    ]);

    const result = await enqueueCaptureDistillation({
      capture: capture as never,
    });

    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "brain-distill-request-capture-1",
      expect.objectContaining({
        queueId: "queue-existing",
        instructions: "Existing guidance.",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        existing: true,
        queueItem: expect.objectContaining({ id: "queue-existing" }),
      }),
    );
  });
});
