import { describe, expect, it } from "vitest";

import {
  acquireIngestionLease,
  assertInventoryComplete,
  consumeIngestionBudget,
  createIngestionBudgetState,
  createIngestionCheckpoint,
  ingestionBudgetStopReason,
  renewIngestionLease,
} from "./orchestration.js";
import { selectInventoryForHydration } from "./selection.js";

describe("ingestion orchestration", () => {
  it("prevents a second owner from taking a live lease", () => {
    const first = acquireIngestionLease(null, {
      owner: "worker-a",
      token: "lease-a",
      ttlMs: 1_000,
      now: 100,
    });
    expect(first.acquired).toBe(true);
    const second = acquireIngestionLease(first.lease, {
      owner: "worker-b",
      token: "lease-b",
      ttlMs: 1_000,
      now: 200,
    });
    expect(second).toEqual({ acquired: false, lease: first.lease });
  });

  it("allows expired leases to be taken and live leases to be renewed", () => {
    const first = acquireIngestionLease(null, {
      owner: "worker-a",
      token: "lease-a",
      ttlMs: 100,
      now: 0,
    }).lease;
    expect(
      renewIngestionLease(first, {
        token: "lease-a",
        ttlMs: 100,
        now: 50,
      })?.expiresAt,
    ).toBe(150);
    expect(
      acquireIngestionLease(first, {
        owner: "worker-b",
        token: "lease-b",
        ttlMs: 100,
        now: 100,
      }).acquired,
    ).toBe(true);
  });

  it("applies runtime, item, and batch limits deterministically", () => {
    let state = createIngestionBudgetState(100);
    state = consumeIngestionBudget(state, { items: 4, batches: 1 });
    const limits = { runtimeMs: 1_000, itemBudget: 5, batchBudget: 2 };
    expect(ingestionBudgetStopReason(limits, state, 200)).toBe(null);
    expect(
      ingestionBudgetStopReason(
        limits,
        consumeIngestionBudget(state, { items: 1 }),
        200,
      ),
    ).toBe("items");
    expect(
      ingestionBudgetStopReason(
        limits,
        consumeIngestionBudget(state, { batches: 1 }),
        200,
      ),
    ).toBe("batches");
    expect(ingestionBudgetStopReason(limits, state, 1_100)).toBe("runtime");
  });

  it("enforces inventory before fetch", () => {
    const checkpoint = createIngestionCheckpoint();
    expect(() => assertInventoryComplete(checkpoint)).toThrow(
      "before inventory is complete",
    );
    expect(() =>
      assertInventoryComplete({ inventoryComplete: true }),
    ).not.toThrow();
  });

  it("treats an explicitly confirmed empty selection as exact", () => {
    const selection = selectInventoryForHydration(
      [
        {
          externalId: "recent",
          sourceModifiedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      {
        selectedExternalIds: [],
        now: new Date("2026-07-16T00:00:00.000Z"),
      },
    );
    expect(selection.selected).toEqual([]);
    expect(selection.deferred.map((item) => item.externalId)).toEqual([
      "recent",
    ]);
  });
});
