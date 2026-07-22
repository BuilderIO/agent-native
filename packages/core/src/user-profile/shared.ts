export const USER_PROFILE_SETTING_KEY = "user-profile";

export interface UserProfile {
  email: string;
  name: string;
}

export function normalizeUserProfileName(
  value: string | null | undefined,
  email: string,
): string {
  const name = value?.trim();
  return name || email;
}
