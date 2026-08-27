import { z } from "zod";

export const USER_PROFILE_SETTING_KEY = "user-profile";

export const ONBOARDING_ROLE_VALUES = [
  "product",
  "design",
  "developer",
  "marketing",
  "sales",
  "ops",
  "individual",
  "other",
] as const;

export const onboardingRoleSchema = z.enum(ONBOARDING_ROLE_VALUES);

export type OnboardingRole = z.infer<typeof onboardingRoleSchema>;

export interface UserProfile {
  email: string;
  name: string;
  onboardingRole?: OnboardingRole | null;
}

export function normalizeUserProfileName(
  value: string | null | undefined,
  email: string,
): string {
  const name = value?.trim();
  return name || email;
}

export function normalizeOnboardingRole(
  value: string | null | undefined,
): OnboardingRole | null {
  if (value == null) return null;
  return onboardingRoleSchema.parse(value);
}
