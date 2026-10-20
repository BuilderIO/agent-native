import { describe, expect, it } from "vitest";

import { WORKFLOW_STORE_LIMITS } from "../adapter.js";
import { jsonByteLength } from "../items.js";
import { StepBuilder } from "./step-builder.js";
import type { FlowItem } from "./types.js";

const flow = (id: string): FlowItem => ({
  id,
  data: {},
  nodes: {},
  inbox: true,
});
const base = {
  runId: "run-1",
  nodeId: "n1",
  mode: "live" as const,
  startedAt: "2026-10-19T12:00:00.000Z",
};
const done = "2026-10-19T12:00:01.000Z";

describe("StepBuilder", () => {
  it("is succeeded when nothing went wrong, with its ports counted", () => {
    const step = new StepBuilder(base);
    step.setPorts({ out: [flow("a"), flow("b")], other: [] });

    expect(step.finish({ finishedAt: done })).toEqual({
      ...base,
      status: "succeeded",
      finishedAt: done,
      ports: {
        out: { count: 2, itemIds: ["a", "b"] },
        other: { count: 0, itemIds: [] },
      },
    });
  });

  it("is as bad as the worst thing that happened to any item", () => {
    const failed = new StepBuilder(base);
    failed.itemFailed({ code: "provider_error", message: "first" });
    failed.itemFailed({ code: "lookup_failed", message: "second" });
    expect(failed.finish({ finishedAt: done })).toMatchObject({
      status: "failed",
      error: { code: "provider_error", message: "first" },
    });

    const check = new StepBuilder(base);
    check.itemFailed({ code: "provider_error", message: "a" });
    check.itemNeedsCheck({ code: "effect_needs_check", message: "b" });
    expect(check.finish({ finishedAt: done }).status).toBe("needs_check");
    expect(check.counts).toEqual({ failed: 1, needsCheck: 1 });
  });

  it("is failed, with the reason, when the step as a whole failed or stopped", () => {
    expect(
      new StepBuilder(base).finish({
        finishedAt: done,
        failure: { code: "output_over_cap", message: "too big" },
      }),
    ).toMatchObject({ status: "failed", error: { code: "output_over_cap" } });
    expect(
      new StepBuilder(base).finish({
        finishedAt: done,
        stop: { code: "ai_cap_reached", message: "cap" },
      }),
    ).toMatchObject({ status: "failed", error: { code: "ai_cap_reached" } });
  });

  it("carries the cut-off, the thread, and the receipts it was told about", () => {
    const step = new StepBuilder(base);
    step.truncated(340);
    step.inputTruncated();
    step.thread("t1");
    step.thread("t2");
    step.receipt("k1");
    step.receipt("k2");

    expect(step.finish({ finishedAt: done })).toMatchObject({
      truncated: { totalAvailable: 340 },
      inputTruncated: true,
      agentThreadId: "t1",
      receiptKeys: ["k1", "k2"],
    });
  });

  it("keeps a step's fields within what the store accepts, and names what it dropped", () => {
    const step = new StepBuilder(base);
    step.field("small", 1);
    step.field("huge", "x".repeat(WORKFLOW_STORE_LIMITS.stepFieldsBytes));

    const { fields } = step.finish({ finishedAt: done });

    expect(fields).toMatchObject({ small: 1, fieldsCut: ["huge"] });
    expect(jsonByteLength(fields)).toBeLessThanOrEqual(
      WORKFLOW_STORE_LIMITS.stepFieldsBytes,
    );
  });

  it("bounds an error message to what a step may hold", () => {
    const step = new StepBuilder(base);
    step.itemFailed({ code: "provider_error", message: "m".repeat(5000) });

    expect(step.finish({ finishedAt: done }).error?.message).toHaveLength(1000);
  });
});
