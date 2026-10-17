export { useOnboarding, type UseOnboardingResult } from "./use-onboarding.js";
export { isFirstRunOnboardingEnabled } from "./first-run-enabled.js";
export {
  dispatchFirstRunOnboardingStatus,
  fetchFirstRunOnboardingStatus,
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
} from "./first-run-status.js";
export {
  useOnboardingPreviewMode,
  useOnboardingPreviewStep,
  ONBOARDING_PREVIEW_STORAGE_KEY,
  ONBOARDING_PREVIEW_QUERY_PARAM,
  ONBOARDING_PREVIEW_QUERY_VALUE,
  ONBOARDING_PREVIEW_STEP_QUERY_PARAM,
  ONBOARDING_PREVIEW_STEPS,
  getOnboardingPreviewStep,
  isOnboardingPreviewQuery,
} from "./use-preview-mode.js";
export type { OnboardingPreviewStep } from "./use-preview-mode.js";
export {
  listFirstRunOnboardingExtensions,
  registerFirstRunOnboardingExtension,
} from "./first-run-registry.js";
export type {
  FirstRunOnboardingExtension,
  FirstRunOnboardingExtensionProps,
} from "./first-run-registry.js";
export type {
  OnboardingStep,
  OnboardingMethod,
  OnboardingMethodBadge,
  OnboardingFormField,
  OnboardingStepStatus,
  OnboardingCapability,
  OnboardingAppProfile,
} from "../../onboarding/types.js";
export {
  registerOnboardingStep,
  listOnboardingSteps,
} from "../../onboarding/registry.js";
