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
  image?: string | null;
  onboardingRole?: OnboardingRole | null;
}

export function isEmailDerivedName(
  value: string | null | undefined,
  email: string,
): boolean {
  const name = value?.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const localPart = normalizedEmail.split("@", 1)[0] ?? "";
  const formattedLocalPart = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ")
    .toLowerCase();
  return (
    !name ||
    name === normalizedEmail ||
    (!!localPart && name === localPart) ||
    (!!formattedLocalPart && name === formattedLocalPart)
  );
}

export function normalizeUserProfileName(
  value: string | null | undefined,
  email: string,
): string {
  const name = value?.trim();
  return name || email;
}

export function resolveUserProfileName(
  email: string,
  storedName: string | null | undefined,
  profileName?: string | null,
): string | null {
  const explicitName = storedName?.trim();
  if (explicitName && !isEmailDerivedName(explicitName, email)) {
    return explicitName;
  }
  const connectedName = profileName?.trim();
  if (connectedName && !isEmailDerivedName(connectedName, email)) {
    return connectedName;
  }
  return explicitName || null;
}

export function normalizeOnboardingRole(
  value: string | null | undefined,
): OnboardingRole | null {
  if (value == null) return null;
  return onboardingRoleSchema.parse(value);
}
