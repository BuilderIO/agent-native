import { describe, expect, it } from "vitest";

import { agentConfig } from "./agent.js";

describe("agent prompt-skills config", () => {
  it.each([{}, { promptSkills: {} }])(
    "includes supporting files by default for %j",
    (input) => {
      expect(agentConfig.parse(input).promptSkills.includeSupportingFiles).toBe(
        true,
      );
    },
  );

  it("accepts explicitly disabling supporting files", () => {
    expect(
      agentConfig.parse({ promptSkills: { includeSupportingFiles: false } })
        .promptSkills.includeSupportingFiles,
    ).toBe(false);
  });
});

describe("agent question-intake config", () => {
  it("keeps the experiment opt-in when no app config is provided", () => {
    expect(agentConfig.parse({}).questionIntake).toBeUndefined();
  });

  it("defaults switches and event lists while normalizing app-provided values", () => {
    expect(
      agentConfig.parse({
        questionIntake: {
          experimentId: " design_no_questions ",
          questionToolNames: [" show-design-questions "],
          treatmentInstructions: " Design with sensible defaults. ",
          trackedEventNames: [" design_ready_viewed "],
        },
      }).questionIntake,
    ).toEqual({
      enabled: false,
      disabled: false,
      experimentId: "design_no_questions",
      questionToolNames: ["show-design-questions"],
      treatmentInstructions: "Design with sensible defaults.",
      trackedEventNames: ["design_ready_viewed"],
      clientTrackedEventNames: [],
    });
  });

  it("accepts the configured enable and emergency-disable switches", () => {
    expect(
      agentConfig.parse({
        questionIntake: {
          enabled: true,
          disabled: true,
          experimentId: "design_no_questions",
          treatmentInstructions: "Design with sensible defaults.",
        },
      }).questionIntake,
    ).toMatchObject({ enabled: true, disabled: true });
  });

  it("rejects blank or missing required experiment instructions", () => {
    const questionIntake = {
      experimentId: "design_no_questions",
      treatmentInstructions: "Design with sensible defaults.",
    };

    expect(
      agentConfig.safeParse({
        questionIntake: { ...questionIntake, experimentId: "   " },
      }).success,
    ).toBe(false);
    expect(
      agentConfig.safeParse({
        questionIntake: { ...questionIntake, treatmentInstructions: "   " },
      }).success,
    ).toBe(false);
    expect(
      agentConfig.safeParse({
        questionIntake: { ...questionIntake, questionToolNames: ["   "] },
      }).success,
    ).toBe(false);
  });
});
