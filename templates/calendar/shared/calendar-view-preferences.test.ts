import { describe, expect, it } from "vitest";

import {
  calendarViewPreferencesEqual,
  DEFAULT_CALENDAR_DAYS,
  DEFAULT_CALENDAR_VIEW_PREFERENCES,
  MAX_CALENDAR_DAYS,
  MIN_CALENDAR_DAYS,
  normalizeNumberOfDays,
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

  it("normalizes the Notion-style displayed-day range", () => {
    expect(normalizeNumberOfDays(0)).toBe(MIN_CALENDAR_DAYS);
    expect(normalizeNumberOfDays(32)).toBe(MAX_CALENDAR_DAYS);
    expect(normalizeNumberOfDays(3.5)).toBe(DEFAULT_CALENDAR_DAYS);
    expect(
      normalizeCalendarViewPreferences({
        numberOfDays: 5,
        showDeclinedEvents: false,
        showWeekNumbers: true,
      }),
    ).toMatchObject({
      numberOfDays: 5,
      showDeclinedEvents: false,
      showWeekNumbers: true,
    });
    expect(DEFAULT_CALENDAR_VIEW_PREFERENCES.numberOfDays).toBe(
      DEFAULT_CALENDAR_DAYS,
    );
  });

  it("includes display toggles in equality", () => {
    const defaultPreferences = normalizeCalendarViewPreferences({});
    expect(
      calendarViewPreferencesEqual(
        defaultPreferences,
        normalizeCalendarViewPreferences({ showWeekNumbers: true }),
      ),
    ).toBe(false);
    expect(
      calendarViewPreferencesEqual(
        defaultPreferences,
        normalizeCalendarViewPreferences({ showDeclinedEvents: false }),
      ),
    ).toBe(false);
  });
});
