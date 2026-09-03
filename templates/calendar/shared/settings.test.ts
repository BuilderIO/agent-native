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

  it("replaces a timezone an older build stored in an unsupported format", () => {
    expect(
      normalizeCalendarSettings({ timezone: "Pacific Standard Time" }).timezone,
    ).toBe("America/New_York");
  });

  it("uses a caller's fallback zone when the stored one is unusable", () => {
    expect(
      normalizeCalendarSettings(
        { timezone: "GMT+2" },
        { timezone: "Pacific/Auckland" },
      ).timezone,
    ).toBe("Pacific/Auckland");
    expect(
      normalizeCalendarSettings({}, { timezone: "Pacific/Auckland" }).timezone,
    ).toBe("Pacific/Auckland");
  });

  it("ignores a fallback that is not a real zone", () => {
    expect(
      normalizeCalendarSettings({}, { timezone: "Pacific Standard Time" })
        .timezone,
    ).toBe("America/New_York");
  });

  it("keeps a stored zone even when a fallback is given", () => {
    expect(
      normalizeCalendarSettings(
        { timezone: "Europe/London" },
        { timezone: "Asia/Tokyo" },
      ).timezone,
    ).toBe("Europe/London");
  });

  it("keeps a valid IANA timezone", () => {
    expect(
      normalizeCalendarSettings({ timezone: "Europe/Warsaw" }).timezone,
    ).toBe("Europe/Warsaw");
  });
});
