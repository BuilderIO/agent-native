import { describe, expect, it } from "vitest";

import {
  NativeSimulationTimelineError,
  planNativeSimulationSteps,
} from "./native-simulation-timeline";

const base = {
  fixedDt: 1 / 120,
  maxInteractiveSteps: 8,
  maxDeterministicSteps: 512,
} as const;

describe("native simulation fixed-step timeline", () => {
  it("samples identical simulation steps at matching 60 Hz and 120 Hz times", () => {
    const atSixty = planNativeSimulationSteps({
      ...base,
      lastCompletedStep: 0,
      targetTime: 1 / 60,
      mode: "interactive",
    });
    const atOneTwenty = planNativeSimulationSteps({
      ...base,
      lastCompletedStep: 0,
      targetTime: 1 / 120,
      mode: "interactive",
    });
    const nextOneTwenty = planNativeSimulationSteps({
      ...base,
      lastCompletedStep: atOneTwenty.completedStep,
      targetTime: 1 / 60,
      mode: "interactive",
    });
    expect(atSixty.steps).toEqual([1, 2]);
    expect([...atOneTwenty.steps, ...nextOneTwenty.steps]).toEqual(
      atSixty.steps,
    );
  });

  it("bounds interactive catch-up without marking a truncated step run complete", () => {
    const first = planNativeSimulationSteps({
      ...base,
      lastCompletedStep: 0,
      targetTime: 1,
      mode: "interactive",
    });
    const second = planNativeSimulationSteps({
      ...base,
      lastCompletedStep: first.completedStep,
      targetTime: 1,
      mode: "interactive",
    });
    expect(first.steps).toHaveLength(8);
    expect(first.caughtUp).toBe(false);
    expect(second.steps[0]).toBe(9);
    expect(second.caughtUp).toBe(false);
  });

  it("replays from seeded step zero for a backward deterministic seek", () => {
    const plan = planNativeSimulationSteps({
      ...base,
      lastCompletedStep: 210,
      targetTime: 0.5,
      mode: "deterministic",
    });
    expect(plan.reset).toBe(true);
    expect(plan.steps[0]).toBe(0);
    expect(plan.steps[plan.steps.length - 1]).toBe(60);
    expect(plan.caughtUp).toBe(true);
  });

  it("rejects over-budget deterministic seeking instead of returning partial state", () => {
    expect(() =>
      planNativeSimulationSteps({
        ...base,
        maxDeterministicSteps: 100,
        lastCompletedStep: -1,
        targetTime: 3,
        mode: "deterministic",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<NativeSimulationTimelineError>>({
        code: "simulation-seek-budget-exceeded",
      }),
    );
  });
});
