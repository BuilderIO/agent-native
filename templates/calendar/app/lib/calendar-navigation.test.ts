import { describe, expect, it } from "vitest";

import {
  getVisibleCalendarDays,
  navigateCalendarDate,
} from "./calendar-navigation";
import { dateKeyToDate, dateToCalendarDateKey } from "./calendar-timezone";

describe("calendar date navigation", () => {
  const selectedDate = dateKeyToDate("2026-09-16");

  it("lands on the start of the destination week", () => {
    const nextWeek = navigateCalendarDate("week", selectedDate, "next", 0);
    expect(dateToCalendarDateKey(nextWeek)).toBe("2026-09-20");
    expect(nextWeek.getHours()).toBe(12);
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("week", selectedDate, "prev", 0),
      ),
    ).toBe("2026-09-06");
  });

  it("respects the configured first day of the week", () => {
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("week", selectedDate, "next", 1),
      ),
    ).toBe("2026-09-21");
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("week", selectedDate, "prev", 1),
      ),
    ).toBe("2026-09-07");
  });

  it("advances by the configured number of displayed days", () => {
    const periodStart = dateKeyToDate("2026-09-14");
    const nextPeriod = navigateCalendarDate("week", periodStart, "next", 1, 5);
    expect(dateToCalendarDateKey(nextPeriod)).toBe("2026-09-19");
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("week", periodStart, "prev", 1, 5),
      ),
    ).toBe("2026-09-09");
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("week", nextPeriod, "next", 1, 5),
      ),
    ).toBe("2026-09-24");
  });

  it("keeps a weekend-only custom range visible when weekends are hidden", () => {
    const sunday = dateKeyToDate("2026-09-13");
    expect(
      getVisibleCalendarDays(sunday, sunday, true).map(dateToCalendarDateKey),
    ).toEqual(["2026-09-13"]);
  });

  it("filters weekends when the custom range also contains weekdays", () => {
    expect(
      getVisibleCalendarDays(
        dateKeyToDate("2026-09-13"),
        dateKeyToDate("2026-09-15"),
        true,
      ).map(dateToCalendarDateKey),
    ).toEqual(["2026-09-14", "2026-09-15"]);
  });

  it("keeps day and month navigation semantics unchanged", () => {
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("day", selectedDate, "next", 0),
      ),
    ).toBe("2026-09-17");
    expect(
      dateToCalendarDateKey(
        navigateCalendarDate("month", selectedDate, "prev", 0),
      ),
    ).toBe("2026-08-16");
  });
});
