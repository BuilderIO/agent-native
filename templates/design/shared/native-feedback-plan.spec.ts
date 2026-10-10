import { describe, expect, it } from "vitest";

import { OWNED_FEEDBACK_TEST_KERNEL } from "./native-effect-owned-test-fixtures";
import {
  planNativeFeedback,
  planNativeFeedbackAdvance,
} from "./native-feedback-plan";

const limits = {
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
};

describe("fixed-grid feedback planning", () => {
  it("accounts for both state sides and the separate display output", () => {
    const result = planNativeFeedback(OWNED_FEEDBACK_TEST_KERNEL, limits);
    expect(result).toEqual({
      ok: true,
      plan: {
        width: 768,
        height: 768,
        workgroupsX: 96,
        workgroupsY: 96,
        stateBytes: 768 * 768 * 8,
        displayBytes: 768 * 768 * 8,
        totalTextureBytes: 768 * 768 * 8 * 3,
      },
    });
  });

  it("rejects an undersized adapter and a resource-heavy grid before allocating", () => {
    expect(
      planNativeFeedback(OWNED_FEEDBACK_TEST_KERNEL, {
        maxTextureDimension2D: 512,
        maxComputeWorkgroupsPerDimension: 65535,
      }),
    ).toEqual({ ok: false, code: "feedback-grid-limit" });
    expect(
      planNativeFeedback(
        {
          ...OWNED_FEEDBACK_TEST_KERNEL,
          grid: {
            ...OWNED_FEEDBACK_TEST_KERNEL.grid,
            width: 2048,
            height: 2048,
          },
        },
        limits,
      ),
    ).toEqual({ ok: false, code: "feedback-grid-limit" });
  });

  it("includes existing mount resources in the per-instance budget", () => {
    expect(
      planNativeFeedback(OWNED_FEEDBACK_TEST_KERNEL, limits, 125_000_000),
    ).toEqual({ ok: false, code: "feedback-resource-budget" });
  });

  it("replays frame zero through a seek without skipping intermediate state", () => {
    const first = planNativeFeedbackAdvance(
      OWNED_FEEDBACK_TEST_KERNEL,
      { completedStep: -1 },
      1 / 30,
    );
    expect(first).toEqual({ ok: true, steps: [0, 1, 2], targetStep: 2 });
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: 2 },
        1 / 60,
      ),
    ).toEqual({ ok: false, code: "feedback-seek-backward" });
  });

  it("fails a seek beyond the per-call budget instead of truncating output", () => {
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: -1 },
        10,
      ),
    ).toEqual({ ok: false, code: "feedback-step-limit" });
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: -1 },
        Number.NaN,
      ),
    ).toEqual({ ok: false, code: "feedback-time-invalid" });
  });

  it("continues an interactive clock beyond the deterministic export horizon without allowing a large seek", () => {
    const horizon = OWNED_FEEDBACK_TEST_KERNEL.timing.maxStepIndex;
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: horizon },
        (horizon + 1) / 60,
        "interactive",
      ),
    ).toEqual({ ok: true, steps: [horizon + 1], targetStep: horizon + 1 });
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: horizon },
        (horizon + 1) / 60,
        "deterministic",
      ),
    ).toEqual({ ok: false, code: "feedback-step-limit" });
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: horizon },
        (horizon + 513) / 60,
        "interactive",
      ),
    ).toEqual({ ok: false, code: "feedback-step-limit" });
    expect(
      planNativeFeedbackAdvance(
        OWNED_FEEDBACK_TEST_KERNEL,
        { completedStep: horizon },
        (horizon - 1) / 60,
        "interactive",
      ),
    ).toEqual({ ok: false, code: "feedback-seek-backward" });
  });
});
