export const USER_PROFILE_SETTING_KEY = "user-profile";

export interface UserProfile {
  email: string;
  name: string;
  image?: string | null;
}

export function isEmailDerivedName(
  value: string | null | undefined,
  email: string,
): boolean {
  const name = value?.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const localPart = normalizedEmail.split("@", 1)[0] ?? "";
  return (
    !name || name === normalizedEmail || (!!localPart && name === localPart)
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
