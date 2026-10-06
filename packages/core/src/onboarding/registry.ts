import type { OnboardingStep } from "./types.js";

const steps = new Map<string, OnboardingStep>();

export function registerOnboardingStep(step: OnboardingStep): void {
  if (!step || typeof step.id !== "string" || !step.id) {
    throw new Error("registerOnboardingStep: step.id is required");
  }
  if (steps.has(step.id)) {
    if (process.env.DEBUG) {
      console.log(
        `[agent-native] Overriding onboarding step "${step.id}" with new registration.`,
      );
    }
  }
  steps.set(step.id, step);
}

export function listOnboardingSteps(): OnboardingStep[] {
  return Array.from(steps.values()).sort((a, b) => a.order - b.order);
}

export function __resetOnboardingRegistry(): void {
  steps.clear();
}
