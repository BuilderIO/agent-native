/**
 * Per-user Assets preferences, stored under one user-setting key so Settings
 * and the generation pipeline agree on a single source of truth.
 */
export const ASSETS_USER_PREFS_KEY = "assets-user-prefs";

export type AssetsUserPrefs = {
  /** Email me when a generation run I started finishes or fails. */
  emailNotifications?: boolean;
};

export interface AssetsNotificationPreferences {
  emailNotifications: boolean;
}

/** No stored preference is a real state, and its meaning is "opted in". */
export function getAssetsNotificationPreferences(
  stored: unknown,
): AssetsNotificationPreferences {
  const prefs =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as AssetsUserPrefs)
      : {};
  return { emailNotifications: prefs.emailNotifications !== false };
}
