import { describe, expect, it } from "vitest";

import { isFirstRunOnboardingEnabled } from "./first-run-enabled.js";

describe("isFirstRunOnboardingEnabled", () => {
  it("defaults to off when the hosted opt-in is absent", () => {
    expect(isFirstRunOnboardingEnabled({})).toBe(false);
    expect(
      isFirstRunOnboardingEnabled({
        VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING: "false",
      }),
    ).toBe(false);
  });

  it.each(["true", "TRUE", "1"])("accepts %s as enabled", (value) => {
    expect(
      isFirstRunOnboardingEnabled({
        VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING: value,
      }),
    ).toBe(true);
  });

  it("uses the resolved app config when no legacy env override is present", () => {
    expect(
      isFirstRunOnboardingEnabled({}, { onboarding: { firstRun: "connect" } }),
    ).toBe(true);
  });

  it("lets an explicit legacy env value override app config", () => {
    expect(
      isFirstRunOnboardingEnabled(
        { VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING: "false" },
        { onboarding: { firstRun: "connect" } },
      ),
    ).toBe(false);
  });
});
