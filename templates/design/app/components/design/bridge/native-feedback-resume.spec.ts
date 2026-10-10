import { describe, expect, it } from "vitest";

import { OWNED_FEEDBACK_TEST_KERNEL } from "../../../../shared/native-effect-owned-test-fixtures";
import { planNativeFeedbackAdvance } from "../../../../shared/native-feedback-plan";
import {
  planNativeFeedbackInteractiveResume,
  type NativeFeedbackResumeClock,
} from "./native-feedback-resume";

const definition = OWNED_FEEDBACK_TEST_KERNEL;
const fixedDt = definition.timing.fixedDt;
const maxStepsPerCall = definition.timing.maxStepsPerCall;

function plan(
  requestedLocalSeconds: number,
  prior: NativeFeedbackResumeClock | null,
  speed = 1,
  initialLocalSeconds = 0,
  completedStep = 0,
) {
  return planNativeFeedbackInteractiveResume({
    requestedLocalSeconds,
    initialLocalSeconds,
    completedStep,
    speed,
    fixedDt,
    maxStepsPerCall,
    prior,
  });
}

describe("interactive feedback clock resumption", () => {
  it("advances ordinary frames exactly and applies the original callback clamp to a long gap", () => {
    const first = plan(0, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const normal = plan(1 / 60, first.nextClock);
    expect(normal.ok).toBe(true);
    if (!normal.ok) return;
    expect(normal.disposition).toBe("exact");
    const background = plan(20 + 1 / 60, normal.nextClock);
    expect(background.ok).toBe(true);
    if (!background.ok) return;
    const steps = planNativeFeedbackAdvance(
      definition,
      { completedStep: 1 },
      background.simulationTimeSeconds,
      "interactive",
    );
    expect(steps.ok).toBe(true);
    if (!steps.ok) return;
    expect(steps.steps.length).toBeLessThanOrEqual(3);
    expect(background.disposition).toBe("clamped");
    expect(background.droppedThisFrameSeconds).toBeGreaterThan(19.94);
    expect(background.nextClock.requestedLocalSeconds).toBe(20 + 1 / 60);
    expect(background.nextClock.simulationLocalSeconds).toBeLessThan(0.067);
  });

  it("keeps an uncommitted frame retryable and resumes the next ordinary frame", () => {
    const first = plan(0, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const proposed = plan(20, first.nextClock);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(plan(20, first.nextClock)).toEqual(proposed);
    const following = plan(20 + 1 / 60, proposed.nextClock);
    expect(following.ok).toBe(true);
    if (!following.ok) return;
    expect(following.droppedThisFrameSeconds).toBe(0);
    expect(following.disposition).toBe("clamped");
    expect(plan(20 + 1 / 60, following.nextClock)).toMatchObject({
      ok: true,
      droppedThisFrameSeconds: 0,
    });
    expect(plan(19, following.nextClock)).toEqual({
      ok: false,
      code: "feedback-seek-backward",
    });
  });

  it("treats speed in instance-local seconds and reports invalid clocks", () => {
    const prior: NativeFeedbackResumeClock = {
      requestedLocalSeconds: 1,
      simulationLocalSeconds: 1,
      droppedLocalSeconds: 0,
    };
    const faster = plan(1 + 2 / 60, prior, 2);
    expect(faster).toMatchObject({
      ok: true,
      disposition: "exact",
      droppedThisFrameSeconds: 0,
    });
    expect(plan(1, prior, Number.NaN)).toEqual({
      ok: false,
      code: "feedback-time-invalid",
    });
    expect(plan(1, { ...prior, droppedLocalSeconds: -1 })).toEqual({
      ok: false,
      code: "feedback-time-invalid",
    });
  });

  it("keeps long-running preview possible while deterministic export retains its step limit", () => {
    const horizon = definition.timing.maxStepIndex;
    const prior: NativeFeedbackResumeClock = {
      requestedLocalSeconds: horizon * fixedDt,
      simulationLocalSeconds: horizon * fixedDt,
      droppedLocalSeconds: 0,
    };
    const next = plan((horizon + 1) * fixedDt, prior);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(
      planNativeFeedbackAdvance(
        definition,
        { completedStep: horizon },
        next.simulationTimeSeconds,
        "interactive",
      ),
    ).toMatchObject({ ok: true, steps: [horizon + 1] });
    expect(
      planNativeFeedbackAdvance(
        definition,
        { completedStep: horizon },
        next.simulationTimeSeconds,
        "deterministic",
      ),
    ).toEqual({ ok: false, code: "feedback-step-limit" });
  });

  it("clamps a recreated interactive state at a late clock without replaying the entire history", () => {
    const recreated = plan(620, null);
    expect(recreated.ok).toBe(true);
    if (!recreated.ok) return;
    expect(recreated.simulationTimeSeconds).toBeCloseTo(0.05);
    expect(recreated.nextClock.droppedLocalSeconds).toBeCloseTo(619.95);
    expect(recreated.disposition).toBe("clamped");
    expect(
      planNativeFeedbackAdvance(
        definition,
        { completedStep: 0 },
        recreated.simulationTimeSeconds,
        "interactive",
      ),
    ).toMatchObject({ ok: true, targetStep: 3 });
    const next = plan(620 + 1 / 60, recreated.nextClock, 1, 0, 3);
    expect(next).toMatchObject({ ok: true, disposition: "clamped" });
  });

  it("preserves a bounded authored offset and committed deterministic state", () => {
    expect(plan(2, null, 1, 2)).toMatchObject({
      ok: true,
      simulationTimeSeconds: 2,
      disposition: "exact",
    });
    expect(plan(602, null, 1, 2)).toMatchObject({
      ok: true,
      simulationTimeSeconds: 2.05,
      disposition: "clamped",
    });
    expect(plan(10, null, 1, 0, 600)).toMatchObject({
      ok: true,
      simulationTimeSeconds: 10,
      disposition: "exact",
    });
    expect(plan(0, null, 1, 1)).toEqual({
      ok: false,
      code: "feedback-seek-backward",
    });
  });
});
