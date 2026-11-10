import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "./index.js";
import { onboardingConfig } from "./onboarding.js";

describe("onboarding configuration", () => {
  it("defaults the experiment to v1 and accepts v2", () => {
    expect(onboardingConfig.parse({}).firstRunCreditsExperiment).toBe("v1");
    expect(
      onboardingConfig.parse({ firstRunCreditsExperiment: "v2" })
        .firstRunCreditsExperiment,
    ).toBe("v2");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("resolves the Builder signup rollback independently of the app opt-in", () => {
    defineAppConfig({ onboarding: { builderSignupExperiment: true } });
    vi.stubEnv("BUILDER_SIGNUP_EXPERIMENT", "0");
    const config = getAppConfig().onboarding;
    expect(config.builderSignupExperiment).toBe(true);
    expect(config.builderSignupExperimentOverride).toBe(false);
  });

  it("validates the deployment override", () => {
    expect(
      onboardingConfig.parse({ firstRunCreditsExperimentOverride: "v1" })
        .firstRunCreditsExperimentOverride,
    ).toBe("v1");
    expect(() =>
      onboardingConfig.parse({ firstRunCreditsExperimentOverride: "v2" }),
    ).toThrow();
  });
});
