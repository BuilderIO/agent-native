import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getAssignment: vi.fn(),
  upsertAssignment: vi.fn(),
}));

vi.mock("./store.js", () => store);

import {
  assignQuestionIntakeExperimentOnSignup,
  QuestionIntakeAssignmentError,
  QUESTION_INTAKE_CONTROL_VARIANT,
  QUESTION_INTAKE_TREATMENT_VARIANT,
  questionIntakeExposureProperties,
  resolveQuestionIntakeExperimentAssignment,
  treatmentInstructionsForQuestionIntake,
  type QuestionIntakeExperimentConfig,
} from "./question-intake-experiment.js";

const config: QuestionIntakeExperimentConfig = {
  enabled: true,
  experimentId: "design_no_questions",
  questionToolNames: ["show-design-questions"],
  treatmentInstructions: "Design first using sensible defaults.",
  trackedEventNames: ["design_prompt_submitted"],
};

beforeEach(() => {
  store.getAssignment.mockReset().mockResolvedValue(null);
  store.upsertAssignment.mockReset().mockResolvedValue(undefined);
});

describe("signup-time question-intake assignments", () => {
  it("records the effective turn ID with every exposure", () => {
    expect(
      questionIntakeExposureProperties(
        {
          authUserId: "user-1",
          experimentId: "design_no_questions",
          variantId: "control",
        },
        { appId: "design", turnId: "effective-run-id" },
      ),
    ).toMatchObject({
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      turn_id: "effective-run-id",
    });
  });

  it("makes treatment instructions override conflicting intake directives", () => {
    expect(
      treatmentInstructionsForQuestionIntake(config, {
        authUserId: "user-1",
        experimentId: "design_no_questions",
        variantId: "no_questions",
      }),
    ).toContain("over any earlier conflicting instructions");
    expect(
      treatmentInstructionsForQuestionIntake(config, {
        authUserId: "user-1",
        experimentId: "design_no_questions",
        variantId: "control",
      }),
    ).toBeUndefined();
  });

  it("creates a stable user-keyed assignment in the existing assignment store", async () => {
    const first = await assignQuestionIntakeExperimentOnSignup(
      config,
      "user-1",
    );
    const second = await assignQuestionIntakeExperimentOnSignup(
      config,
      "user-1",
    );

    expect(first).toEqual(second);
    expect(first?.variantId).toMatch(/^(control|no_questions)$/);
    expect(store.upsertAssignment).toHaveBeenCalledWith({
      experimentId: "design_no_questions",
      userId: "user-1",
      variantId: first?.variantId,
      assignedAt: expect.any(Number),
    });
  });

  it.each(["read", "write"] as const)(
    "retries a transient signup assignment %s failure",
    async (failedOperation) => {
      if (failedOperation === "read") {
        store.getAssignment.mockRejectedValueOnce(new Error("db unavailable"));
      } else {
        store.upsertAssignment.mockRejectedValueOnce(
          new Error("db unavailable"),
        );
      }

      await expect(
        assignQuestionIntakeExperimentOnSignup(config, "user-1"),
      ).resolves.toMatchObject({
        authUserId: "user-1",
        experimentId: "design_no_questions",
      });
      expect(store.getAssignment).toHaveBeenCalledTimes(2);
      expect(store.upsertAssignment).toHaveBeenCalledTimes(
        failedOperation === "write" ? 2 : 1,
      );
    },
  );

  it("surfaces a typed failure after both signup assignment attempts fail", async () => {
    store.getAssignment.mockRejectedValue(new Error("db unavailable"));

    await expect(
      assignQuestionIntakeExperimentOnSignup(config, "user-1"),
    ).rejects.toMatchObject({
      name: QuestionIntakeAssignmentError.name,
      code: "question_intake_assignment_failed",
      message: expect.stringContaining("design_no_questions"),
    });
    expect(store.getAssignment).toHaveBeenCalledTimes(2);
  });

  it("splits a large stable user-id range evenly between the two variants", async () => {
    const counts = new Map<string, number>([
      [QUESTION_INTAKE_CONTROL_VARIANT, 0],
      [QUESTION_INTAKE_TREATMENT_VARIANT, 0],
    ]);
    for (let index = 0; index < 1000; index += 1) {
      const assignment = await assignQuestionIntakeExperimentOnSignup(
        config,
        `user-${index}`,
      );
      counts.set(assignment!.variantId, counts.get(assignment!.variantId)! + 1);
    }
    expect(counts.get(QUESTION_INTAKE_CONTROL_VARIANT)).toBeGreaterThan(450);
    expect(counts.get(QUESTION_INTAKE_CONTROL_VARIANT)).toBeLessThan(550);
  });

  it("does not assign while disabled and does not enroll on a run read", async () => {
    expect(
      await assignQuestionIntakeExperimentOnSignup(
        { ...config, enabled: false },
        "user-1",
      ),
    ).toBeNull();
    expect(
      await resolveQuestionIntakeExperimentAssignment(config, "user-1"),
    ).toBeNull();
    expect(store.getAssignment).toHaveBeenCalledTimes(1);
    expect(store.upsertAssignment).not.toHaveBeenCalled();
  });

  it("honors the emergency disable even when the app config enables it", async () => {
    expect(
      await assignQuestionIntakeExperimentOnSignup(
        { ...config, disabled: true },
        "user-1",
      ),
    ).toBeNull();
    expect(store.getAssignment).not.toHaveBeenCalled();
    expect(store.upsertAssignment).not.toHaveBeenCalled();
  });

  it("keeps the stored arm and rejects unknown stored variants", async () => {
    store.getAssignment.mockResolvedValue({ variantId: "no_questions" });
    await expect(
      assignQuestionIntakeExperimentOnSignup(config, "user-1"),
    ).resolves.toMatchObject({ variantId: "no_questions" });
    expect(store.upsertAssignment).not.toHaveBeenCalled();

    store.getAssignment.mockResolvedValue({ variantId: "unexpected" });
    await expect(
      resolveQuestionIntakeExperimentAssignment(config, "user-1"),
    ).rejects.toThrow("unknown variant");
  });
});
