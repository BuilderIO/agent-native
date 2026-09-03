import { describe, expect, it } from "vitest";

import {
  applyClipsNotificationPrefsPatch,
  getClipsNotificationPreferences,
  isClipsNotificationEnabled,
} from "./clips-notification-prefs.js";

describe("Clips notification preferences", () => {
  it("defaults every optional category to enabled", () => {
    expect(getClipsNotificationPreferences(null)).toEqual({
      emailNotifications: true,
      viewNotifications: true,
      commentNotifications: true,
      reactionNotifications: true,
      recapNotifications: true,
    });
  });

  it("lets the global switch turn every category off atomically", () => {
    const next = applyClipsNotificationPrefsPatch(
      { viewNotifications: true, commentNotifications: true },
      { emailNotifications: false },
    );

    expect(getClipsNotificationPreferences(next)).toEqual({
      emailNotifications: false,
      viewNotifications: false,
      commentNotifications: false,
      reactionNotifications: false,
      recapNotifications: false,
    });
  });

  it("keeps category changes independent while the global switch is on", () => {
    const next = applyClipsNotificationPrefsPatch(null, {
      emailNotifications: true,
      viewNotifications: false,
    });

    expect(isClipsNotificationEnabled(next, "views")).toBe(false);
    expect(isClipsNotificationEnabled(next, "comments")).toBe(true);
  });
});
