import { describe, expect, it } from "vitest";

import type { StepRecord } from "../contract.js";
import { MAX_INLINE_ITEMS } from "../items.js";
import { mergeStepRecords } from "./step-merge.js";

const step = (over: Partial<StepRecord> = {}): StepRecord => ({
  runId: "run-1",
  nodeId: "pause",
  status: "succeeded",
  mode: "live",
  startedAt: "2026-10-19T12:00:00.000Z",
  finishedAt: "2026-10-19T12:00:01.000Z",
  ports: {},
  ...over,
});

describe("mergeStepRecords", () => {
  it("adds the counts of a port and joins its item ids", () => {
    const merged = mergeStepRecords(
      step({ ports: { replied: { count: 1, itemIds: ["a"] } } }),
      step({
        ports: {
          replied: { count: 2, itemIds: ["b", "c"] },
          parked: { count: 1, itemIds: ["d"] },
        },
      }),
    );

    expect(merged.ports).toEqual({
      replied: { count: 3, itemIds: ["a", "b", "c"] },
      parked: { count: 1, itemIds: ["d"] },
    });
  });

  it("keeps no more item ids than a step may list, and still counts them all", () => {
    const ids = (from: number) =>
      Array.from(
        { length: MAX_INLINE_ITEMS },
        (_, index) => `i${from + index}`,
      );

    const merged = mergeStepRecords(
      step({ ports: { out: { count: MAX_INLINE_ITEMS, itemIds: ids(0) } } }),
      step({ ports: { out: { count: MAX_INLINE_ITEMS, itemIds: ids(500) } } }),
    );

    expect(merged.ports.out.count).toBe(2 * MAX_INLINE_ITEMS);
    expect(merged.ports.out.itemIds).toHaveLength(MAX_INLINE_ITEMS);
  });

  it("keeps the worst status and the first error, so a clean later pass cannot hide an earlier failure", () => {
    const merged = mergeStepRecords(
      step({
        status: "failed",
        error: { code: "provider_error", message: "first" },
      }),
      step({ status: "succeeded" }),
    );

    expect(merged.status).toBe("failed");
    expect(merged.error).toEqual({ code: "provider_error", message: "first" });
    expect(
      mergeStepRecords(
        step({ status: "needs_check" }),
        step({ status: "failed" }),
      ).status,
    ).toBe("failed");
    expect(
      mergeStepRecords(
        step({ status: "skipped" }),
        step({ status: "succeeded" }),
      ).status,
    ).toBe("succeeded");
  });

  it("totals numeric fields and lets the later value of any other field stand", () => {
    const merged = mergeStepRecords(
      step({ fields: { in: 2, woke: 1, wait: "reply", note: "first" } }),
      step({ fields: { in: 3, parked: 3, note: "second" } }),
    );

    expect(merged.fields).toEqual({
      in: 5,
      woke: 1,
      parked: 3,
      wait: "reply",
      note: "second",
    });
  });

  it("spans both runs and keeps the receipts of both", () => {
    const merged = mergeStepRecords(
      step({ receiptKeys: ["k1"] }),
      step({
        startedAt: "2026-10-19T12:00:05.000Z",
        finishedAt: "2026-10-19T12:00:09.000Z",
        receiptKeys: ["k2"],
      }),
    );

    expect(merged).toMatchObject({
      startedAt: "2026-10-19T12:00:00.000Z",
      finishedAt: "2026-10-19T12:00:09.000Z",
      receiptKeys: ["k1", "k2"],
    });
  });

  it("keeps the larger cut-off and any note that input was cut", () => {
    const merged = mergeStepRecords(
      step({ truncated: { totalAvailable: 10 } }),
      step({ truncated: { totalAvailable: 40 }, inputTruncated: true }),
    );

    expect(merged.truncated).toEqual({ totalAvailable: 40 });
    expect(merged.inputTruncated).toBe(true);
  });
});
