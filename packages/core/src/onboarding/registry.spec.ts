import { describe, it, expect, beforeEach } from "vitest";
import {
  registerOnboardingStep,
  listOnboardingSteps,
  __resetOnboardingRegistry,
} from "./registry.js";
import type { OnboardingStep } from "./types.js";

function makeStep(
  id: string,
  order: number,
  overrides: Partial<OnboardingStep> = {},
): OnboardingStep {
  return {
    id,
    order,
    title: id,
    description: `${id} step`,
    methods: [],
    isComplete: () => false,
    ...overrides,
  };
}

describe("onboarding registry", () => {
  beforeEach(() => __resetOnboardingRegistry());

  it("lists steps sorted by order", () => {
    registerOnboardingStep(makeStep("c", 30));
    registerOnboardingStep(makeStep("a", 10));
    registerOnboardingStep(makeStep("b", 20));
    expect(listOnboardingSteps().map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("lets later registrations override earlier ones with the same id", () => {
    registerOnboardingStep(makeStep("llm", 10, { title: "First" }));
    registerOnboardingStep(makeStep("llm", 10, { title: "Second" }));
    const all = listOnboardingSteps();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Second");
  });

  it("throws when id is missing", () => {
    expect(() =>
      registerOnboardingStep({
        ...makeStep("x", 10),
        id: "",
      }),
    ).toThrow(/id is required/);
  });
});
