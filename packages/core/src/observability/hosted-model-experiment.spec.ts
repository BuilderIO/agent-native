import { describe, expect, it } from "vitest";

import {
  HOSTED_DEFAULT_MODEL_CONTROL,
  HOSTED_DEFAULT_MODEL_EXPERIMENT_ID,
  HOSTED_DEFAULT_MODEL_TREATMENT,
  hostedDefaultModelExperimentBucket,
  isHostedDefaultModelExperimentEnabled,
  resolveHostedDefaultModelExperiment,
} from "./hosted-model-experiment.js";

describe("hosted default model experiment", () => {
  it("auto-enables only for first-party hosted domains", () => {
    expect(
      isHostedDefaultModelExperimentEnabled({
        URL: "https://chat.agent-native.com",
      }),
    ).toBe(true);
    expect(
      isHostedDefaultModelExperimentEnabled({
        URL: "https://agent-native.com",
      }),
    ).toBe(true);
    expect(
      isHostedDefaultModelExperimentEnabled({
        URL: "https://agent-native.com.example.test",
      }),
    ).toBe(false);
    expect(
      isHostedDefaultModelExperimentEnabled({
        URL: "https://customer.example.test",
      }),
    ).toBe(false);
  });

  it("supports explicit enable and emergency-disable overrides", () => {
    expect(
      isHostedDefaultModelExperimentEnabled({
        AGENT_NATIVE_HOSTED_MODEL_EXPERIMENT: "true",
        URL: "https://preview.example.test",
      }),
    ).toBe(true);
    expect(
      isHostedDefaultModelExperimentEnabled({
        AGENT_NATIVE_HOSTED_MODEL_EXPERIMENT: "off",
        URL: "https://chat.agent-native.com",
      }),
    ).toBe(false);
  });

  it("assigns the same user to one stable cross-app bucket", () => {
    expect(hostedDefaultModelExperimentBucket("Person@Example.com")).toBe(
      hostedDefaultModelExperimentBucket(" person@example.com "),
    );
  });

  it("assigns approximately twenty percent of users to Luna", () => {
    let treatment = 0;
    for (let index = 0; index < 10_000; index++) {
      if (
        hostedDefaultModelExperimentBucket(`user-${index}@example.test`) < 20
      ) {
        treatment++;
      }
    }
    expect(treatment).toBeGreaterThan(1_800);
    expect(treatment).toBeLessThan(2_200);
  });

  it("only overrides an unselected default on the Builder engine", () => {
    const env = { AGENT_NATIVE_HOSTED_MODEL_EXPERIMENT: "true" };
    const supportedModels = [
      HOSTED_DEFAULT_MODEL_CONTROL.model,
      HOSTED_DEFAULT_MODEL_TREATMENT.model,
    ];
    let treatmentUser = "";
    for (let index = 0; index < 100; index++) {
      const user = `user-${index}@example.test`;
      if (hostedDefaultModelExperimentBucket(user) < 20) {
        treatmentUser = user;
        break;
      }
    }

    expect(
      resolveHostedDefaultModelExperiment({
        userId: treatmentUser,
        engineName: "builder",
        isDefaultModelSelection: true,
        supportedModels,
        env,
      }),
    ).toEqual({
      model: HOSTED_DEFAULT_MODEL_TREATMENT.model,
      assignment: {
        experimentId: HOSTED_DEFAULT_MODEL_EXPERIMENT_ID,
        variantId: HOSTED_DEFAULT_MODEL_TREATMENT.id,
      },
    });

    expect(
      resolveHostedDefaultModelExperiment({
        userId: treatmentUser,
        engineName: "builder",
        isDefaultModelSelection: false,
        supportedModels,
        env,
      }),
    ).toBeNull();
    expect(
      resolveHostedDefaultModelExperiment({
        userId: treatmentUser,
        engineName: "anthropic",
        isDefaultModelSelection: true,
        supportedModels,
        env,
      }),
    ).toBeNull();
  });

  it("fails closed when the assigned model is unavailable", () => {
    expect(
      resolveHostedDefaultModelExperiment({
        userId: "user@example.test",
        engineName: "builder",
        isDefaultModelSelection: true,
        supportedModels: [],
        env: { AGENT_NATIVE_HOSTED_MODEL_EXPERIMENT: "true" },
      }),
    ).toBeNull();
  });
});
