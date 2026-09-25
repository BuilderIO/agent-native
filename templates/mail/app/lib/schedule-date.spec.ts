import { describe, expect, it } from "vitest";

import { parseSendLaterDate } from "./schedule-date";

describe("parseSendLaterDate", () => {
  const referenceDate = () => new Date(2026, 8, 14, 16, 0, 0, 0);

  it("defaults relative dates to 8 AM in the local timezone", () => {
    const date = parseSendLaterDate("3 days", referenceDate());

    expect(date?.getDate()).toBe(17);
    expect(date?.getHours()).toBe(8);
  });

  it("maps day-part suggestions to their expected local times", () => {
    const date = parseSendLaterDate("tomorrow afternoon", referenceDate());

    expect(date?.getDate()).toBe(15);
    expect(date?.getHours()).toBe(13);
  });

  it("keeps explicit times and advances time-only input to the next occurrence", () => {
    const date = parseSendLaterDate("8 am", referenceDate());

    expect(date?.getDate()).toBe(15);
    expect(date?.getHours()).toBe(8);
  });

  it("preserves an explicit weekday and time", () => {
    const date = parseSendLaterDate("Monday 9:45am", referenceDate());

    expect(date?.getDate()).toBe(21);
    expect(date?.getHours()).toBe(9);
    expect(date?.getMinutes()).toBe(45);
  });

  it("moves a yearless date into the future when its next occurrence is next year", () => {
    const date = parseSendLaterDate("aug 7", referenceDate());

    expect(date?.getFullYear()).toBe(2027);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(7);
  });

  it("rejects explicit past dates and unrecognized input", () => {
    expect(parseSendLaterDate("2020-01-01", referenceDate())).toBeNull();
    expect(parseSendLaterDate("nonsense", referenceDate())).toBeNull();
  });
});
