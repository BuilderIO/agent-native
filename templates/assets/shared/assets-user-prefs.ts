/**
 * Per-user Assets preferences, stored under one user-setting key so Settings
 * and the generation pipeline agree on a single source of truth.
 */
export const ASSETS_USER_PREFS_KEY = "assets-user-prefs";

export type AssetsUserPrefs = {
  /** Email me when a generation run I started finishes or fails. */
  emailNotifications?: boolean;
};
