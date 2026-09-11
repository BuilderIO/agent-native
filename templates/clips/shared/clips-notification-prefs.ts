export const CLIPS_NOTIFICATION_CATEGORIES = [
  "views",
  "comments",
  "reactions",
  "recaps",
] as const;

export type ClipsNotificationCategory =
  (typeof CLIPS_NOTIFICATION_CATEGORIES)[number];

export const CLIPS_NOTIFICATION_PREFERENCE_FIELDS = {
  views: "viewNotifications",
  comments: "commentNotifications",
  reactions: "reactionNotifications",
  recaps: "recapNotifications",
} as const satisfies Record<ClipsNotificationCategory, string>;

export type ClipsNotificationPreferenceField =
  (typeof CLIPS_NOTIFICATION_PREFERENCE_FIELDS)[ClipsNotificationCategory];

export type ClipsNotificationPrefs = {
  emailNotifications?: boolean;
  viewNotifications?: boolean;
  commentNotifications?: boolean;
  reactionNotifications?: boolean;
  recapNotifications?: boolean;
};

export type ClipsNotificationPreferences = {
  emailNotifications: boolean;
} & Record<ClipsNotificationPreferenceField, boolean>;

export type ClipsNotificationPrefsPatch = Partial<
  Pick<
    ClipsNotificationPrefs,
    "emailNotifications" | ClipsNotificationPreferenceField
  >
>;

export function getClipsNotificationPreferences(
  prefs: ClipsNotificationPrefs | Record<string, unknown> | null | undefined,
): ClipsNotificationPreferences {
  const allEnabled = prefs?.emailNotifications !== false;
  return {
    emailNotifications: allEnabled,
    viewNotifications: allEnabled && prefs?.viewNotifications !== false,
    commentNotifications: allEnabled && prefs?.commentNotifications !== false,
    reactionNotifications: allEnabled && prefs?.reactionNotifications !== false,
    recapNotifications: allEnabled && prefs?.recapNotifications !== false,
  };
}

export function isClipsNotificationEnabled(
  prefs: ClipsNotificationPrefs | Record<string, unknown> | null | undefined,
  category: ClipsNotificationCategory,
): boolean {
  const normalized = getClipsNotificationPreferences(prefs);
  return normalized[CLIPS_NOTIFICATION_PREFERENCE_FIELDS[category]];
}

export function applyClipsNotificationPrefsPatch(
  current: ClipsNotificationPrefs | Record<string, unknown> | null | undefined,
  patch: ClipsNotificationPrefsPatch,
): ClipsNotificationPrefs {
  const next: ClipsNotificationPrefs = {
    ...(current && typeof current === "object" ? current : {}),
  };

  if (patch.emailNotifications !== undefined) {
    next.emailNotifications = patch.emailNotifications;
    for (const field of Object.values(CLIPS_NOTIFICATION_PREFERENCE_FIELDS)) {
      next[field] = patch.emailNotifications;
    }
  }

  for (const field of Object.values(CLIPS_NOTIFICATION_PREFERENCE_FIELDS)) {
    if (patch[field] !== undefined) next[field] = patch[field];
  }

  return next;
}
