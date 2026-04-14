/**
 * Framework-level onboarding system.
 *
 * Templates register steps the agent sidebar should show as a setup checklist.
 * The server auto-mounts `/_agent-native/onboarding/*` routes and the client
 * hook polls them — see `@agent-native/core/client/onboarding`.
 */

export { registerOnboardingStep, listOnboardingSteps } from "./registry.js";
export type {
  OnboardingStep,
  OnboardingMethod,
  OnboardingMethodBadge,
  OnboardingFormField,
  OnboardingStepStatus,
} from "./types.js";
export {
  createOnboardingPlugin,
  defaultOnboardingPlugin,
  type OnboardingPluginOptions,
} from "./plugin.js";
export { registerDefaultOnboardingSteps } from "./default-steps.js";
