import { describe, expect, it } from "vitest";

import { isCalendarTimezone } from "./timezone";

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
