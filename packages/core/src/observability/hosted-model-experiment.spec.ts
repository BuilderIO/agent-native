import { describe, expect, it } from "vitest";

import {
  HOSTED_MODEL_EXPERIMENT_CONTROL,
  HOSTED_MODEL_EXPERIMENT_ID,
  HOSTED_MODEL_EXPERIMENT_TREATMENT,
  hostedModelExperimentBucket,
  hostedModelExperimentVariant,
  isHostedModelExperimentEnabled,
  resolveHostedModelExperiment,
} from "./hosted-model-experiment.js";

const base = {
  enabled: true,
  engineName: "builder",
  defaultModel: "gpt-6-luna",
  model: "gpt-6-luna",
  effort: "high",
};

function userInArm(treatment: boolean): string {
  for (let index = 0; ; index++) {
    const email = `user-${index}@example.test`;
    const inTreatment = hostedModelExperimentBucket(email) < 50;
    if (inTreatment === treatment) return email;
  }
}

describe("hosted model experiment", () => {
  it("auto follows the first-party check; on forces it; off always disables", () => {
    expect(
      isHostedModelExperimentEnabled({ setting: "auto", firstParty: true }),
    ).toBe(true);
    expect(
      isHostedModelExperimentEnabled({ setting: "auto", firstParty: false }),
    ).toBe(false);
    expect(
      isHostedModelExperimentEnabled({ setting: "on", firstParty: false }),
    ).toBe(true);
    expect(
      isHostedModelExperimentEnabled({ setting: "off", firstParty: true }),
    ).toBe(false);
  });

  it("buckets case-insensitively and splits roughly evenly", () => {
    expect(hostedModelExperimentBucket("Person@Example.com")).toBe(
      hostedModelExperimentBucket(" person@example.com "),
    );
    let treatment = 0;
    for (let index = 0; index < 10_000; index++) {
      if (hostedModelExperimentBucket(`user-${index}@example.test`) < 50) {
        treatment++;
      }
    }
    expect(treatment).toBeGreaterThan(4_800);
    expect(treatment).toBeLessThan(5_200);
  });

  it("gives treatment Haiku 5.5 at medium and control the untouched default", () => {
    expect(
      resolveHostedModelExperiment({ ...base, userEmail: userInArm(true) }),
    ).toEqual({
      treatment: true,
      model: HOSTED_MODEL_EXPERIMENT_TREATMENT.model,
      effort: "medium",
      assignment: {
        experimentId: HOSTED_MODEL_EXPERIMENT_ID,
        variantId: HOSTED_MODEL_EXPERIMENT_TREATMENT.id,
      },
    });
    expect(
      resolveHostedModelExperiment({ ...base, userEmail: userInArm(false) }),
    ).toEqual({
      treatment: false,
      model: "gpt-6-luna",
      assignment: {
        experimentId: HOSTED_MODEL_EXPERIMENT_ID,
        variantId: HOSTED_MODEL_EXPERIMENT_CONTROL.id,
      },
    });
  });

  it("leaves deliberate choices, other engines, and disabled runs alone", () => {
    const userEmail = userInArm(true);
    expect(
      resolveHostedModelExperiment({
        ...base,
        userEmail,
        model: "claude-sonnet-5",
      }),
    ).toBeNull();
    expect(
      resolveHostedModelExperiment({ ...base, userEmail, effort: "low" }),
    ).toBeNull();
    expect(
      resolveHostedModelExperiment({
        ...base,
        userEmail,
        engineName: "openai",
      }),
    ).toBeNull();
    expect(
      resolveHostedModelExperiment({ ...base, userEmail, enabled: false }),
    ).toBeNull();
    expect(
      resolveHostedModelExperiment({ ...base, userEmail: undefined }),
    ).toBeNull();
  });

  it("finds the hosted variant even when other experiments share the turn", () => {
    expect(
      hostedModelExperimentVariant([
        { experimentId: "other-exp", variantId: "a" },
        {
          experimentId: HOSTED_MODEL_EXPERIMENT_ID,
          variantId: HOSTED_MODEL_EXPERIMENT_TREATMENT.id,
        },
      ]),
    ).toBe(HOSTED_MODEL_EXPERIMENT_TREATMENT.id);
    expect(
      hostedModelExperimentVariant([
        { experimentId: "other-exp", variantId: "a" },
      ]),
    ).toBeUndefined();
  });
});
