import { afterEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getOnboardingAppProfile } from "./app-profile.js";

describe("first-run credits experiment configuration", () => {
  afterEach(() => {
    delete process.env.FIRST_RUN_CREDITS_EXPERIMENT;
    resetAppConfigForTests();
  });

  it.each(["design", "slides", "clips"])(
    "exposes the configured v2 experiment for %s",
    (appId) => {
      defineAppConfig({ onboarding: { firstRunCreditsExperiment: "v2" } });
      expect(getOnboardingAppProfile(appId).firstRunCreditsExperiment).toBe(
        "v2",
      );
    },
  );

  it("lets the deployment kill switch override the app default", () => {
    defineAppConfig({ onboarding: { firstRunCreditsExperiment: "v2" } });
    process.env.FIRST_RUN_CREDITS_EXPERIMENT = "v1";
    expect(getOnboardingAppProfile("clips").firstRunCreditsExperiment).toBe(
      "v1",
    );
  });
});
