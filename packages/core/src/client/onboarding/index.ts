/**
 * Client entry for the framework onboarding system.
 *
 * Subpath: `@agent-native/core/client/onboarding`
 */

export { useOnboarding, type UseOnboardingResult } from "./use-onboarding.js";
export { OnboardingPanel } from "./OnboardingPanel.js";
export { OnboardingBanner } from "./OnboardingBanner.js";
export { SetupButton } from "./SetupButton.js";
export type {
  OnboardingStep,
  OnboardingMethod,
  OnboardingMethodBadge,
  OnboardingFormField,
  OnboardingStepStatus,
} from "../../onboarding/types.js";
export {
  registerOnboardingStep,
  listOnboardingSteps,
} from "../../onboarding/registry.js";
