import { describe, expect, it } from "vitest";

import { normalizeCalendarSettings } from "./settings";

describe("calendar settings", () => {
  it("adds the Sunday-first default to existing settings", () => {
    expect(
      normalizeCalendarSettings({
        timezone: "Europe/London",
        bookingPageTitle: "Meet",
        bookingPageDescription: "Choose a time.",
        defaultEventDuration: 45,
      }),
    ).toEqual({
      timezone: "Europe/London",
      bookingPageTitle: "Meet",
      bookingPageDescription: "Choose a time.",
      defaultEventDuration: 45,
      weekStart: "sunday",
    });
  });

  it("preserves a valid Monday-first setting", () => {
    expect(normalizeCalendarSettings({ weekStart: "monday" }).weekStart).toBe(
      "monday",
    );
  });
});
