import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "./index.js";
import { onboardingConfig } from "./onboarding.js";

describe("onboarding configuration", () => {
  it("defaults Builder signup to 50% and accepts a full rollout", () => {
    expect(onboardingConfig.parse({}).builderSignupAutomaticPercent).toBe(50);
    expect(
      onboardingConfig.parse({ builderSignupAutomaticPercent: 100 })
        .builderSignupAutomaticPercent,
    ).toBe(100);
  });

  it.each([-1, 50.5, 101])(
    "rejects an invalid Builder signup allocation of %s",
    (builderSignupAutomaticPercent) => {
      expect(
        onboardingConfig.safeParse({ builderSignupAutomaticPercent }).success,
      ).toBe(false);
    },
  );

  it("keeps hosted Builder signup off by default and accepts exact hostnames only", () => {
    const config = onboardingConfig.parse({});
    expect(config.builderSignupExperiment).toBe(false);
    expect(config.builderSignupHostedHosts).toEqual([]);
    expect(
      onboardingConfig.parse({
        builderSignupHostedHosts: ["design.agent-native.com"],
      }).builderSignupHostedHosts,
    ).toEqual(["design.agent-native.com"]);
    for (const host of [
      "https://design.agent-native.com",
      "design.agent-native.com:443",
      "*.agent-native.com",
      "Design.agent-native.com",
      "localhost",
    ])
      expect(
        onboardingConfig.safeParse({ builderSignupHostedHosts: [host] })
          .success,
      ).toBe(false);
  });

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
