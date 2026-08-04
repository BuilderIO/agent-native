/** Per-user Analytics preferences shared by Settings and notification senders. */
export const ANALYTICS_USER_PREFS_KEY = "analytics-user-prefs";

export type AnalyticsUserPrefs = {
  /** New JavaScript error emails are opt-in. */
  errorEmailNotifications?: boolean;
  /** Play the completion sound when an agent run finishes successfully. */
  bellSoundEnabled?: boolean;
};
