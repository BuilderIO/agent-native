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

export const onboardingRoleSchema = z.string().trim().min(1).max(120);

export type OnboardingRole = z.infer<typeof onboardingRoleSchema>;
export type OnboardingRoleCategory = (typeof ONBOARDING_ROLE_VALUES)[number];

export function getOnboardingRoleCategory(
  value: OnboardingRole,
): OnboardingRoleCategory {
  return ONBOARDING_ROLE_VALUES.includes(value as OnboardingRoleCategory)
    ? (value as OnboardingRoleCategory)
    : "other";
}

const ONBOARDING_ROLE_TEXT_MAX_LENGTH = 80;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const HANDLE_PATTERN = /(^|\s)@[A-Za-z0-9_.-]+/g;
const DIGIT_RUN_PATTERN = /\+?\d[\d ().-]{4,}\d/g;

/**
 * A typed "Other" role as analytics may keep it; undefined for a listed role.
 * Analytics rows outlive the profile and show on shared dashboards, so emails,
 * links, handles and phone-like digit runs are replaced before the length cap.
 */
export function getOnboardingRoleTextForAnalytics(
  value: OnboardingRole,
): string | undefined {
  if (ONBOARDING_ROLE_VALUES.includes(value as OnboardingRoleCategory)) {
    return undefined;
  }
  const text = value
    .replace(EMAIL_PATTERN, "[email]")
    .replace(URL_PATTERN, "[url]")
    .replace(HANDLE_PATTERN, "$1[handle]")
    .replace(DIGIT_RUN_PATTERN, "[number]")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text)
    .slice(0, ONBOARDING_ROLE_TEXT_MAX_LENGTH)
    .join("")
    .trimEnd();
}

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
