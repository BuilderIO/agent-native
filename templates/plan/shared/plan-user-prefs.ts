/**
 * Per-user Plan preferences, stored under one user-setting key so Settings and
 * the notification senders read and write the same object.
 */

export const PLAN_USER_PREFS_KEY = "plan-user-prefs";

export type PlanUserPrefs = {
  /** Comment, reply, and mention emails only — never access requests. */
  emailNotifications?: boolean;
};
