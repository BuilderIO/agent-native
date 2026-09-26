/**
 * Per-user Documents preferences, stored under one user-setting key so
 * Settings and the notification senders read and write the same object.
 */

export const CONTENT_USER_PREFS_KEY = "content-user-prefs";

export type ContentUserPrefs = {
  /** Comment, reply, and mention emails only — never share invites. */
  emailNotifications?: boolean;
};

export interface ContentNotificationPreferences {
  /** Comment, reply, and mention emails. */
  emailNotifications: boolean;
}

/**
 * The preferences the comment senders act on. A missing blob or field is
 * opted in, matching `resolveActivityRecipients`.
 */
export function getContentNotificationPreferences(
  prefs: ContentUserPrefs | Record<string, unknown> | null | undefined,
): ContentNotificationPreferences {
  return { emailNotifications: prefs?.emailNotifications !== false };
}
