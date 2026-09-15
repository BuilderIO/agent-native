/**
 * Per-user Slides preferences, stored under one user-setting key so Settings
 * and the notification senders read and write the same object.
 */

export const SLIDES_USER_PREFS_KEY = "slides-user-prefs";

export type SlidesUserPrefs = {
  /** Comment and reply emails only — never share invites. */
  emailNotifications?: boolean;
};
