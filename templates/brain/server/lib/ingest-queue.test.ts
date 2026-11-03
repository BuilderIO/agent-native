import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onConflictDoUpdate: vi.fn(async () => undefined),
  schema: {
    brainIngestQueue: {
      dedupeKey: "dedupeKey",
      status: "status",
      leaseExpiresAt: "leaseExpiresAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  isNull: (column: unknown) => ({ type: "is-null", column }),
  lt: (column: unknown, value: unknown) => ({
    type: "lt",
    column,
    value,
  }),
  ne: (column: unknown, value: unknown) => ({ type: "ne", column, value }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({ onConflictDoUpdate: mocks.onConflictDoUpdate }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "queue-1" }],
        }),
      }),
    }),
  }),
  schema: mocks.schema,
}));

vi.mock("./brain.js", () => ({
  nanoid: () => "queue-1",
  nowIso: () => "2026-07-21T00:00:00.000Z",
  stableJson: (value: unknown) => JSON.stringify(value),
}));

import { getDb } from "../db/index.js";
import {
  enqueueBrainOperation,
  enqueueCaptureInvalidation,
} from "./ingest-queue.js";

describe("enqueueBrainOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the capture transaction through both enqueue helpers", async () => {
    const transaction = getDb();
    const insert = vi.spyOn(transaction, "insert");
    const select = vi.spyOn(transaction, "select");
    await enqueueCaptureInvalidation(
      {
        captureId: "capture-1",
        sourceId: "source-1",
        reason: "content-changed",
        next: {
          contentHash: "content-hash",
          sensitivityPolicyVersion: "2",
          aclHash: "acl-hash",
        },
      },
      transaction,
    );
    expect(insert).toHaveBeenCalledWith(mocks.schema.brainIngestQueue);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("resets retry state when a completed or failed operation is requeued", async () => {
    await enqueueBrainOperation({
      operation: "search-index",
      dedupeKey: "search-index-backfill:capture-1:set-1",
      sourceId: "source-1",
      captureId: "capture-1",
      payload: { requiredEmbeddingSetId: "set-1" },
    });

    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: "queued",
          attempts: 0,
          error: null,
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
  });
});
