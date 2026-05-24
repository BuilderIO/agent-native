/**
 * Workbench startup plugin. Registers Workbench-specific concerns at boot
 * time (onboarding steps, recurring jobs, etc.).
 *
 * The onboarding steps live in `../lib/onboarding-steps.ts` so room agents
 * can edit step copy / completion logic without touching this plugin
 * wiring. Step bodies are documented there.
 *
 * The framework's default onboarding plugin is auto-mounted because
 * Workbench does not provide a custom `onboarding.ts` plugin — calling
 * `registerOnboardingStep()` here is enough; the default plugin reads from
 * the in-memory registry on every `/_agent-native/onboarding/steps`
 * request.
 */

import { registerWorkbenchOnboarding } from "../lib/onboarding-steps.js";

export default async (_nitroApp: unknown): Promise<void> => {
  registerWorkbenchOnboarding();
};
