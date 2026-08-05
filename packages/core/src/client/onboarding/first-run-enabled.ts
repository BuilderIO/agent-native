const FIRST_RUN_ONBOARDING_ENV_KEY = "VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING";

export function isFirstRunOnboardingEnabled(
  env: Record<string, string | boolean | undefined> = (import.meta.env ??
    {}) as Record<string, string | boolean | undefined>,
): boolean {
  const value = env[FIRST_RUN_ONBOARDING_ENV_KEY];
  return (
    value === true ||
    (typeof value === "string" &&
      ["1", "true"].includes(value.trim().toLowerCase()))
  );
}
