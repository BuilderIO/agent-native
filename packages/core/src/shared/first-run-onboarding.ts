export const FIRST_RUN_ONBOARDING_COOKIE = "agent-native-first-run";
export const FIRST_RUN_ONBOARDING_MAX_AGE = 24 * 60 * 60;
export const FIRST_RUN_ONBOARDING_COMPLETED_KEY =
  "onboarding:first-run-completed";
/**
 * Set only when the framework provisions the user's first default
 * organization. Membership in an existing organization must never qualify a
 * user for the first-run flow, even if an old signup cookie is still present.
 */
export const FIRST_RUN_ONBOARDING_ELIGIBLE_KEY =
  "onboarding:first-run-eligible";
