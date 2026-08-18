import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expireSensitivityQuarantines: vi.fn(async () => 0),
  processBrainIngestQueueOnce: vi.fn(async () => ({
    processed: [],
    deferred: [],
    failed: [],
  })),
  syncDueBrainSourcesOnce: vi.fn(async () => ({
    synced: [],
    failed: [],
  })),
}));

vi.mock("h3", () => ({
  createError: (input: unknown) => input,
  defineEventHandler: (handler: unknown) => handler,
  getHeader: () => undefined,
}));

vi.mock("../../../../../jobs/process-ingest-queue.js", () => ({
  processBrainIngestQueueOnce: mocks.processBrainIngestQueueOnce,
}));

vi.mock("../../../../jobs/sync-sources.js", () => ({
  syncDueBrainSourcesOnce: mocks.syncDueBrainSourcesOnce,
}));

vi.mock("../../../../lib/brain.js", () => ({
  expireSensitivityQuarantines: mocks.expireSensitivityQuarantines,
}));

import handler, { BRAIN_QUEUE_SWEEP_LIMIT } from "./run.post.js";

describe("Brain scheduled queue sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ = true;
  });

  it("drains a bounded batch instead of one queue row per minute", async () => {
    await (handler as unknown as (event: unknown) => Promise<unknown>)(
      undefined,
    );

    expect(BRAIN_QUEUE_SWEEP_LIMIT).toBe(10);
    expect(mocks.processBrainIngestQueueOnce).toHaveBeenCalledWith({
      limit: 10,
      runDistillation: true,
      maxDistillations: 1,
    });
  });
});
