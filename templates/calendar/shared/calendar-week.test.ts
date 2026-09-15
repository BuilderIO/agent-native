import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALENDAR_WEEK_START,
  getWeekdayOrder,
  getWeekStartsOn,
  isCalendarWeekStart,
} from "./calendar-week";

describe("calendar week settings", () => {
  it("defaults to a Sunday-first week", () => {
    expect(DEFAULT_CALENDAR_WEEK_START).toBe("sunday");
    expect(getWeekStartsOn(undefined)).toBe(0);
    expect(getWeekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("orders a Monday-first week without changing weekday identity", () => {
    expect(getWeekStartsOn("monday")).toBe(1);
    expect(getWeekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("accepts only persisted week-start values", () => {
    expect(isCalendarWeekStart("sunday")).toBe(true);
    expect(isCalendarWeekStart("monday")).toBe(true);
    expect(isCalendarWeekStart("friday")).toBe(false);
    expect(isCalendarWeekStart(undefined)).toBe(false);
  });
});
