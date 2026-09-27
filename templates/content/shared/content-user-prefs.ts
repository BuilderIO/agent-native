export const CONTENT_USER_PREFS_KEY = "content-user-prefs";

export type ContentUserPrefs = {
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
