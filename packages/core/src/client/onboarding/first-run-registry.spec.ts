import { describe, expect, it } from "vitest";

import {
  listFirstRunOnboardingExtensions,
  registerFirstRunOnboardingExtension,
} from "./first-run-registry.js";

describe("first-run onboarding extension registry", () => {
  it("registers multiple app-owned screens in order", () => {
    const first = () => null;
    const second = () => null;

    registerFirstRunOnboardingExtension({
      id: "registry-test-first",
      component: first,
    });
    registerFirstRunOnboardingExtension({
      id: "registry-test-second",
      component: second,
    });

    const extensions = listFirstRunOnboardingExtensions();
    const ids = extensions
      .filter((extension) => extension.id.startsWith("registry-test-"))
      .map((extension) => extension.id);

    expect(ids).toEqual(["registry-test-first", "registry-test-second"]);
  });

  it("replaces a screen when an app hot reloads the same id", () => {
    const original = () => null;
    const replacement = () => null;

    registerFirstRunOnboardingExtension({
      id: "registry-test-replace",
      component: original,
    });
    registerFirstRunOnboardingExtension({
      id: "registry-test-replace",
      component: replacement,
    });

    const matches = listFirstRunOnboardingExtensions().filter(
      (extension) => extension.id === "registry-test-replace",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.component).toBe(replacement);
  });

  it("requires a non-empty id", () => {
    expect(() =>
      registerFirstRunOnboardingExtension({
        id: "  ",
        component: () => null,
      }),
    ).toThrow("extension.id is required");
  });
});
