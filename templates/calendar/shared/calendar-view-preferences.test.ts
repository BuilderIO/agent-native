import { describe, expect, it } from "vitest";

import {
  calendarViewPreferencesEqual,
  normalizeCalendarViewPreferences,
} from "./calendar-view-preferences.js";

describe("shared Google calendar visibility preferences", () => {
  it("keeps only boolean visibility overrides", () => {
    const preferences = normalizeCalendarViewPreferences({
      googleCalendarVisibility: {
        friends: true,
        studio: false,
        invalid: "yes" as unknown as boolean,
      },
    });

    expect(preferences.googleCalendarVisibility).toEqual({
      friends: true,
      studio: false,
    });
  });

  it("includes visibility overrides in equality", () => {
    const visible = normalizeCalendarViewPreferences({
      googleCalendarVisibility: { friends: true },
    });
    const hidden = normalizeCalendarViewPreferences({
      googleCalendarVisibility: { friends: false },
    });

    expect(calendarViewPreferencesEqual(visible, hidden)).toBe(false);
  });
});
