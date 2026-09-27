export const SLIDES_USER_PREFS_KEY = "slides-user-prefs";

export type SlidesUserPrefs = {
  emailNotifications?: boolean;
};

export interface SlidesNotificationPreferences {
  /** Comment and reply emails. */
  emailNotifications: boolean;
}

/**
 * The preferences the comment senders act on. A missing blob or field is
 * opted in, matching `resolveActivityRecipients`.
 */
export function getSlidesNotificationPreferences(
  prefs: SlidesUserPrefs | Record<string, unknown> | null | undefined,
): SlidesNotificationPreferences {
  return { emailNotifications: prefs?.emailNotifications !== false };
}
