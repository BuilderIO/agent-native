import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readBuildFirstRunOnboardingMode,
  shouldWriteFirstRunOnboardingEligibility,
} from "./first-run-onboarding-build-mode.js";

const KEY = "AGENT_NATIVE_BUILD_FIRST_RUN_ONBOARDING";

describe("readBuildFirstRunOnboardingMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["off", "app", "connect", "connect-and-integrations"] as const)(
    "reads the build-time %s mode",
    (mode) => {
      vi.stubEnv(KEY, mode);
      expect(readBuildFirstRunOnboardingMode()).toBe(mode);
    },
  );

  it.each(["", "APP", "on", "connect-and"])(
    "ignores the unknown value %j",
    (value) => {
      vi.stubEnv(KEY, value);
      expect(readBuildFirstRunOnboardingMode()).toBeUndefined();
    },
  );

  it("writes eligibility when no build mode is embedded", () => {
    vi.stubEnv(KEY, undefined);
    expect(readBuildFirstRunOnboardingMode()).toBeUndefined();
    expect(shouldWriteFirstRunOnboardingEligibility()).toBe(true);
  });

  it("does not write eligibility for a build that turned onboarding off", () => {
    vi.stubEnv(KEY, "off");
    expect(shouldWriteFirstRunOnboardingEligibility()).toBe(false);
  });
});
