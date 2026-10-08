export const ASSETS_USER_PREFS_KEY = "assets-user-prefs";

export type AssetsUserPrefs = {
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
