import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_VIEW_PREFERENCES,
  normalizeCalendarViewPreferences,
} from "@shared/calendar-view-preferences";
import { getEventDisplayColor } from "./event-colors";
import type { CalendarEvent } from "@shared/api";

const googleEvent: CalendarEvent = {
  id: "google-1",
  title: "Team sync",
  description: "",
  location: "",
  start: "2026-05-06T15:00:00.000Z",
  end: "2026-05-06T15:30:00.000Z",
  source: "google",
  accountEmail: "steve@builder.io",
  attendees: [
    { email: "steve@builder.io", self: true },
    { email: "alex@builder.io" },
  ],
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

describe("calendar view preferences", () => {
  it("normalizes invalid values back to defaults", () => {
    expect(
      normalizeCalendarViewPreferences({
        hideWeekends: true,
        colorMode: "rainbow" as any,
        singleColor: "blue",
      }),
    ).toEqual({
      ...DEFAULT_CALENDAR_VIEW_PREFERENCES,
      hideWeekends: true,
    });
  });

  it("uses the single local display color without changing overlay colors", () => {
    const preferences = {
      hideWeekends: false,
      colorMode: "single" as const,
      singleColor: "#CD6B6B",
    };

    expect(getEventDisplayColor(googleEvent, preferences)).toBe("#CD6B6B");
    expect(
      getEventDisplayColor(
        {
          ...googleEvent,
          overlayEmail: "teammate@example.com",
          color: "#4ECDC4",
        },
        preferences,
      ),
    ).toBe("#4ECDC4");
  });
});
