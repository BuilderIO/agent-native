import { describe, expect, it } from "vitest";
import { z } from "zod";

import { WORKFLOW_STORE_LIMITS, WorkflowStoreError } from "./adapter.js";
import { WorkflowError, type StepRecord } from "./contract.js";
import { MAX_STEP_OUTPUT_BYTES } from "./items.js";
import {
  assembleItemState,
  assertRunOutcome,
  normalizeInstant,
  parseStoredJson,
  prepareContext,
  prepareStep,
  receiptTransitionError,
  resolveLeaseTtlMs,
  resolveLimit,
  toStoredJson,
  uniqueItemIds,
} from "./store-rules.js";

function step(overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    runId: "run-1",
    nodeId: "assess",
    status: "succeeded",
    mode: "live",
    startedAt: "2026-10-18T10:00:00Z",
    ports: { out: { count: 1, itemIds: ["item-1"] } },
    ...overrides,
  };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as WorkflowStoreError | WorkflowError).code;
  }
  return undefined;
}

describe("normalizeInstant", () => {
  it("returns UTC with milliseconds so text order is time order", () => {
    expect(normalizeInstant("2026-10-18T14:00:00+02:00", "t")).toBe(
      "2026-10-18T12:00:00.000Z",
    );
    expect(normalizeInstant("2026-10-18T12:00:00Z", "t")).toBe(
      "2026-10-18T12:00:00.000Z",
    );
  });

  it("rejects text that is not an ISO date-time", () => {
    expect(codeOf(() => normalizeInstant("yesterday", "t"))).toBe(
      "invalid_record",
    );
    expect(codeOf(() => normalizeInstant("2026-10-18", "t"))).toBe(
      "invalid_record",
    );
  });
});

describe("limits", () => {
  it("defaults to the maximum and refuses anything outside 1..max", () => {
    expect(resolveLimit(undefined, 20, "x")).toBe(20);
    expect(resolveLimit(1, 20, "x")).toBe(1);
    for (const bad of [0, -1, 21, 2.5, Number.NaN]) {
      expect(codeOf(() => resolveLimit(bad, 20, "x"))).toBe("invalid_record");
    }
  });

  it("bounds lease ttl between a second and an hour", () => {
    expect(resolveLeaseTtlMs(undefined)).toBe(15 * 60 * 1000);
    expect(resolveLeaseTtlMs(WORKFLOW_STORE_LIMITS.leaseMaxTtlMs)).toBe(
      3_600_000,
    );
    expect(codeOf(() => resolveLeaseTtlMs(999))).toBe("invalid_record");
    expect(codeOf(() => resolveLeaseTtlMs(3_600_001))).toBe("invalid_record");
  });

  it("drops repeated item ids but keeps the order", () => {
    expect(uniqueItemIds(["b", "a", "b", "c", "a"], "x")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("toStoredJson", () => {
  it("returns what a column round trip would hold", () => {
    expect(
      toStoredJson({ a: 1, b: undefined, c: [undefined] }, "x").value,
    ).toEqual({
      a: 1,
      c: [null],
    });
  });

  it("rejects values with no JSON form", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(codeOf(() => toStoredJson(circular, "x"))).toBe("invalid_record");
    expect(codeOf(() => toStoredJson(undefined, "x"))).toBe("invalid_record");
    expect(codeOf(() => toStoredJson(1n, "x"))).toBe("invalid_record");
  });
});

describe("parseStoredJson", () => {
  const schema = z.object({ n: z.number() });

  it("reads valid JSON", () => {
    expect(parseStoredJson('{"n":1}', schema, "thing")).toEqual({ n: 1 });
  });

  it("calls a missing, unparseable, or misshapen column corrupt, never empty", () => {
    for (const raw of [null, undefined, "", "{", '{"n":"1"}', "[]"]) {
      expect(codeOf(() => parseStoredJson(raw, schema, "thing"))).toBe(
        "corrupt_record",
      );
    }
  });
});

describe("prepareStep", () => {
  it("accepts a step exactly at the caps", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    expect(() =>
      prepareStep(step({ ports: { out: { count: 100, itemIds: ids } } })),
    ).not.toThrow();
    const overhead = JSON.stringify({ n: "" }).length;
    expect(() =>
      prepareStep(
        step({
          fields: {
            n: "x".repeat(WORKFLOW_STORE_LIMITS.stepFieldsBytes - overhead - 2),
          },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects one id or one byte past the caps with output_over_cap", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `item-${i}`);
    expect(
      codeOf(() =>
        prepareStep(step({ ports: { out: { count: 101, itemIds: ids } } })),
      ),
    ).toBe("output_over_cap");
    expect(
      codeOf(() =>
        prepareStep(
          step({
            fields: { n: "x".repeat(WORKFLOW_STORE_LIMITS.stepFieldsBytes) },
          }),
        ),
      ),
    ).toBe("output_over_cap");
  });

  it("counts every port together against the step output cap", () => {
    const port = {
      count: 100,
      itemIds: Array.from({ length: 100 }, (_, i) => `${i}-${"z".repeat(190)}`),
    };
    expect(MAX_STEP_OUTPUT_BYTES).toBe(64 * 1024);
    expect(
      codeOf(() =>
        prepareStep(step({ ports: { a: port, b: port, c: port, d: port } })),
      ),
    ).toBe("output_over_cap");
  });

  it("rejects a count smaller than the ids it lists", () => {
    expect(
      codeOf(() =>
        prepareStep(step({ ports: { out: { count: 0, itemIds: ["a"] } } })),
      ),
    ).toBe("invalid_record");
  });

  it("returns instants as UTC", () => {
    const prepared = prepareStep(
      step({
        startedAt: "2026-10-18T14:00:00+02:00",
        finishedAt: "2026-10-18T14:00:05+02:00",
      }),
    );
    expect(prepared.startedAt).toBe("2026-10-18T12:00:00.000Z");
    expect(prepared.finishedAt).toBe("2026-10-18T12:00:05.000Z");
  });
});

describe("prepareContext", () => {
  it("is exactly capped at 8 KB", () => {
    const overhead = JSON.stringify({ n: "" }).length;
    expect(() =>
      prepareContext({ n: "x".repeat(8192 - overhead) }),
    ).not.toThrow();
    expect(
      codeOf(() => prepareContext({ n: "x".repeat(8192 - overhead + 1) })),
    ).toBe("output_over_cap");
  });
});

describe("receiptTransitionError", () => {
  const key = "wf:item:node:1";

  it("allows only none to started, and started to done or failed", () => {
    expect(receiptTransitionError(null, { key, status: "started" })).toBeNull();
    expect(
      receiptTransitionError({ status: "started" }, { key, status: "done" }),
    ).toBeNull();
    expect(
      receiptTransitionError({ status: "started" }, { key, status: "failed" }),
    ).toBeNull();
  });

  it("calls a second started receipt a conflict, and every other move invalid", () => {
    for (const existing of ["started", "done", "failed"] as const) {
      expect(
        receiptTransitionError({ status: existing }, { key, status: "started" })
          ?.code,
      ).toBe("receipt_conflict");
    }
    expect(receiptTransitionError(null, { key, status: "done" })?.code).toBe(
      "invalid_transition",
    );
    for (const existing of ["done", "failed"] as const) {
      for (const next of ["done", "failed"] as const) {
        expect(
          receiptTransitionError({ status: existing }, { key, status: next })
            ?.code,
        ).toBe("invalid_transition");
      }
    }
  });
});

describe("assertRunOutcome", () => {
  const error = { code: "budget_paused" as const, message: "out of time" };

  it("ties a failure or pause to an error and keeps success clean", () => {
    expect(() => assertRunOutcome("succeeded", undefined)).not.toThrow();
    expect(() => assertRunOutcome("failed", error)).not.toThrow();
    expect(() => assertRunOutcome("paused", error)).not.toThrow();
    expect(codeOf(() => assertRunOutcome("failed", undefined))).toBe(
      "invalid_record",
    );
    expect(codeOf(() => assertRunOutcome("paused", undefined))).toBe(
      "invalid_record",
    );
    expect(codeOf(() => assertRunOutcome("succeeded", error))).toBe(
      "invalid_record",
    );
  });
});

describe("assembleItemState", () => {
  it("leaves out what is not set and flags a row that no longer fits", () => {
    const state = assembleItemState({
      workflowId: "wf-1",
      graphVersion: 1,
      itemId: "item-1",
      parkedAtNode: null,
      wake: null,
      context: {},
      counters: {},
      leasedBy: null,
      leaseUntil: null,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
    expect(Object.keys(state).sort()).toEqual([
      "context",
      "counters",
      "graphVersion",
      "itemId",
      "updatedAt",
      "workflowId",
    ]);
    expect(
      codeOf(() =>
        assembleItemState({
          workflowId: "wf-1",
          graphVersion: 0,
          itemId: "item-1",
          parkedAtNode: null,
          wake: null,
          context: {},
          counters: {},
          leasedBy: null,
          leaseUntil: null,
          updatedAt: "2026-10-18T10:00:00.000Z",
        }),
      ),
    ).toBe("corrupt_record");
  });
});
