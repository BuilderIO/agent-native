import { describe, expect, it } from "vitest";

import { onboardingConfig } from "./onboarding.js";

describe("onboarding configuration", () => {
  it("defaults the experiment to v1 and accepts v2", () => {
    expect(onboardingConfig.parse({}).firstRunCreditsExperiment).toBe("v1");
    expect(
      onboardingConfig.parse({ firstRunCreditsExperiment: "v2" })
        .firstRunCreditsExperiment,
    ).toBe("v2");
  });

  it("validates the deployment override", () => {
    expect(
      onboardingConfig.parse({ firstRunCreditsExperimentOverride: "v1" })
        .firstRunCreditsExperimentOverride,
    ).toBe("v1");
    expect(() =>
      onboardingConfig.parse({ firstRunCreditsExperimentOverride: "invalid" }),
    ).toThrow();
  });
});
