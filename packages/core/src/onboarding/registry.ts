/**
 * In-process registry of onboarding steps.
 *
 * Templates (or the framework itself) call `registerOnboardingStep` at module
 * load time — typically from a server plugin. The onboarding HTTP routes read
 * from this registry on every request so overrides and late-registered steps
 * are picked up without a restart.
 */

import type { OnboardingStep } from "./types.js";

const steps = new Map<string, OnboardingStep>();

/**
 * Register (or override) an onboarding step.
 *
 * Subsequent registrations with the same `id` replace the previous definition
 * — templates can override framework defaults this way.
 */
export function registerOnboardingStep(step: OnboardingStep): void {
  if (!step || typeof step.id !== "string" || !step.id) {
    throw new Error("registerOnboardingStep: step.id is required");
  }
  if (steps.has(step.id)) {
    // Override intentionally supported. Log only when DEBUG is on so template
    // authors who deliberately override defaults don't see warnings.
    if (process.env.DEBUG) {
      console.log(
        `[agent-native] Overriding onboarding step "${step.id}" with new registration.`,
      );
    }
  }
  steps.set(step.id, step);
}

/**
 * Return all registered onboarding steps, sorted by `order` ascending.
 * Ties are broken by registration order (insertion order).
 */
export function listOnboardingSteps(): OnboardingStep[] {
  return Array.from(steps.values()).sort((a, b) => a.order - b.order);
}

/** Test helper — clears the registry between runs. Not part of the public API. */
export function __resetOnboardingRegistry(): void {
  steps.clear();
}
