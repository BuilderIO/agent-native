import { describe, expect, it } from "vitest";

import { endOfDayInZone } from "../../../actions/create-scheduled-task";
import { todayDay } from "./date-grid";

describe("analytics-2 clock-matrix regressions (idea-6cf3cb)", () => {
  it("todayDay uses the local calendar date rather than the UTC date", () => {
    const localDate = new Date(2026, 10, 20, 23, 30, 0);
    expect(todayDay(localDate)).toBe("2026-11-20");

    const leapDay = new Date(2028, 1, 29, 0, 15, 0);
    expect(todayDay(leapDay)).toBe("2028-02-29");
  });

  it("endOfDayInZone converges across DST boundaries and rejects impossible leap dates", () => {
    // 2026-10-03 is the day before Australia/Sydney springs forward (+10 -> +11 on Oct 4 02:00):
    // 2026-10-03 23:59:59 AEST (+10) = 2026-10-03T13:59:59.000Z
    expect(endOfDayInZone("2026-10-03", "Australia/Sydney")).toBe(
      "2026-10-03T13:59:59.000Z",
    );
    // 2026-04-04 is the day before Australia/Sydney falls back (+11 -> +10 on Apr 5 03:00):
    // 2026-04-04 23:59:59 AEDT (+11) = 2026-04-04T12:59:59.000Z
    expect(endOfDayInZone("2026-04-04", "Australia/Sydney")).toBe(
      "2026-04-04T12:59:59.000Z",
    );
    // Valid leap day succeeds
    expect(endOfDayInZone("2028-02-29", "UTC")).toBe(
      "2028-02-29T23:59:59.000Z",
    );
    // Non-leap Feb 29 must reject with 400 instead of silently rolling to Mar 1
    expect(() => endOfDayInZone("2026-02-29", "UTC")).toThrow(/calendar date/i);
  });
});
