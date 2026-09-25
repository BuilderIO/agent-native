import { describe, expect, it } from "vitest";

import {
  addDaysToDateKey,
  dateKeyInTimezone,
  dateTimeInTimezoneToIso,
  isCalendarTimezone,
} from "./timezone";

describe("isCalendarTimezone", () => {
  it("accepts a valid IANA zone", () => {
    expect(isCalendarTimezone("Europe/Warsaw")).toBe(true);
  });

  it("rejects a zone Intl does not know", () => {
    expect(isCalendarTimezone("Pacific Standard Time")).toBe(false);
    expect(isCalendarTimezone("GMT+2")).toBe(false);
  });

  it("rejects a missing or non-string value instead of throwing", () => {
    expect(isCalendarTimezone(undefined)).toBe(false);
    expect(isCalendarTimezone(null)).toBe(false);
    expect(isCalendarTimezone("")).toBe(false);
    expect(isCalendarTimezone("   ")).toBe(false);
    expect(isCalendarTimezone(42)).toBe(false);
  });

  it("does not report a non-RangeError fault as an invalid zone", () => {
    const format = Intl.DateTimeFormat;
    const boom = new TypeError("Intl is broken");
    // @ts-expect-error — replacing the constructor for this assertion only
    Intl.DateTimeFormat = function () {
      throw boom;
    };
    try {
      expect(() => isCalendarTimezone("Europe/Warsaw")).toThrow(boom);
    } finally {
      Intl.DateTimeFormat = format;
    }
  });
});

describe("dateTimeInTimezoneToIso", () => {
  it("resolves an ordinary wall clock", () => {
    expect(
      dateTimeInTimezoneToIso("2026-08-19", "09:00", "America/New_York"),
    ).toBe("2026-08-19T13:00:00.000Z");
  });

  // Santiago jumps 00:00 -> 01:00, so local midnight never happens. Collapsing
  // backward would put the day boundary at 23:00 the previous day.
  it("uses the first instant after a skipped midnight", () => {
    expect(
      dateTimeInTimezoneToIso("2026-09-06", "00:00", "America/Santiago"),
    ).toBe("2026-09-06T04:00:00.000Z");
  });

  // Collapsing backward here would turn a 60-minute event into a 0-minute one.
  it("keeps a duration whose end lands in a spring-forward gap", () => {
    const start = dateTimeInTimezoneToIso(
      "2026-03-08",
      "01:30",
      "America/New_York",
    );
    const end = dateTimeInTimezoneToIso(
      "2026-03-08",
      "02:30",
      "America/New_York",
    );
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(
      60 * 60_000,
    );
  });

  it("picks the earlier instant when a wall clock happens twice", () => {
    expect(
      dateTimeInTimezoneToIso("2026-11-01", "01:30", "America/New_York"),
    ).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("date keys", () => {
  it("reads the calendar day an instant falls on", () => {
    const instant = new Date("2026-08-20T01:00:00Z"); // still Aug 19 in New York
    expect(dateKeyInTimezone(instant, "America/New_York")).toBe("2026-08-19");
    expect(dateKeyInTimezone(instant, "Europe/Warsaw")).toBe("2026-08-20");
  });

  it("shifts a key across a month boundary", () => {
    expect(addDaysToDateKey("2026-08-30", 7)).toBe("2026-09-06");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});
