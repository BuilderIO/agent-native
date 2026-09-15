import { describe, expect, it } from "vitest";

import { navigateCalendarDate } from "./calendar-navigation";
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
