import { describe, expect, it } from "vitest";

import {
  dateKeyToDate,
  eventOverlapsCalendarDay,
  getCalendarDayBounds,
  getDateKeyInTimezone,
  getEventSegmentForCalendarDay,
  getViewDateRange,
  moveEventToCalendarDate,
  normalizeTimezone,
} from "./calendar-timezone";
import { dateTimeInTimezoneToIso } from "./event-form-utils";

describe("calendar timezone helpers", () => {
  it("keeps selected date keys in the pinned timezone across travel", () => {
    const instant = "2026-08-14T23:30:00.000Z";

    expect(getDateKeyInTimezone(instant, "America/Los_Angeles")).toBe(
      "2026-08-14",
    );
    expect(getDateKeyInTimezone(instant, "Asia/Tokyo")).toBe("2026-08-15");
  });

  it("uses zoned midnight bounds across a DST transition", () => {
    const bounds = getCalendarDayBounds(
      dateKeyToDate("2026-03-08"),
      "America/New_York",
    );

    expect(bounds.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("lays out a cross-midnight instant using pinned wall-clock time", () => {
    const event = {
      start: "2026-08-14T23:30:00.000Z",
      end: "2026-08-15T01:00:00.000Z",
      allDay: false as const,
    };
    const day = dateKeyToDate("2026-08-14");

    expect(eventOverlapsCalendarDay(event, day, "America/Los_Angeles")).toBe(
      true,
    );
    expect(
      getEventSegmentForCalendarDay(event, day, "America/Los_Angeles"),
    ).toMatchObject({
      topMinutes: 16 * 60 + 30,
      durationMinutes: 90,
      startsOnDay: true,
      endsOnDay: true,
    });
  });

  it("keeps a same-day timed draft on a date-carrier selected day", () => {
    const timezone = "America/Chicago";
    const day = dateKeyToDate("2026-08-13");
    const event = {
      start: dateTimeInTimezoneToIso("2026-08-13", "16:00", timezone),
      end: dateTimeInTimezoneToIso("2026-08-13", "16:30", timezone),
      allDay: false as const,
    };

    expect(eventOverlapsCalendarDay(event, day, timezone)).toBe(true);
    expect(getEventSegmentForCalendarDay(event, day, timezone)).toMatchObject({
      topMinutes: 16 * 60,
      durationMinutes: 30,
      startsOnDay: true,
      endsOnDay: true,
    });
  });

  it("moves an event by display date without changing its wall-clock time", () => {
    expect(
      moveEventToCalendarDate(
        {
          start: "2026-08-14T23:30:00.000Z",
          end: "2026-08-15T01:00:00.000Z",
          allDay: false,
        },
        dateKeyToDate("2026-08-17"),
        "America/Los_Angeles",
      ),
    ).toEqual({
      start: "2026-08-17T23:30:00.000Z",
      end: "2026-08-18T01:00:00.000Z",
    });
  });

  it("honors weekStartsOn when computing week bounds in the pinned timezone", () => {
    const selectedDate = dateKeyToDate("2026-08-13");

    expect(
      getViewDateRange("week", selectedDate, "America/Los_Angeles", 0),
    ).toEqual({
      from: "2026-08-09T07:00:00.000Z",
      to: "2026-08-16T07:00:00.000Z",
    });
    expect(
      getViewDateRange("week", selectedDate, "America/Los_Angeles", 1),
    ).toEqual({
      from: "2026-08-10T07:00:00.000Z",
      to: "2026-08-17T07:00:00.000Z",
    });
  });

  it("falls back to the browser timezone when a saved zone is invalid", () => {
    expect(normalizeTimezone("Not/AZone")).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
  });
});
