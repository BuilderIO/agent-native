import { describe, expect, it } from "vitest";

import { EMPTY_DURATION, formatDuration } from "./format-duration";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatDuration", () => {
  it("shows seconds under a minute, with one decimal under 10", () => {
    expect(formatDuration(0)).toBe("0 sec");
    expect(formatDuration(2.34)).toBe("2.3 sec");
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(59.4)).toBe("59 sec");
  });

  it("shows whole minutes under an hour", () => {
    expect(formatDuration(59.6)).toBe("1 min");
    expect(formatDuration(MINUTE)).toBe("1 min");
    expect(formatDuration(2 * MINUTE)).toBe("2 min");
    expect(formatDuration(16 * MINUTE)).toBe("16 min");
    expect(formatDuration(59 * MINUTE + 29)).toBe("59 min");
  });

  it("moves to hours once minutes round to 60", () => {
    expect(formatDuration(59 * MINUTE + 30)).toBe("1 hour");
    expect(formatDuration(HOUR)).toBe("1 hour");
    expect(formatDuration(1.5 * HOUR)).toBe("1.5 hours");
  });

  it("shows hours under 48, with one decimal under 10", () => {
    expect(formatDuration(7.4 * HOUR)).toBe("7.4 hours");
    expect(formatDuration(7 * HOUR)).toBe("7 hours");
    expect(formatDuration(9.96 * HOUR)).toBe("10 hours");
    expect(formatDuration(16 * HOUR)).toBe("16 hours");
    expect(formatDuration(32 * HOUR)).toBe("32 hours");
    expect(formatDuration(47.4 * HOUR)).toBe("47 hours");
  });

  it("moves to days once hours round to 48", () => {
    expect(formatDuration(47.6 * HOUR)).toBe("2 days");
    expect(formatDuration(48 * HOUR)).toBe("2 days");
    expect(formatDuration(3.1 * DAY)).toBe("3.1 days");
    expect(formatDuration(12 * DAY)).toBe("12 days");
    expect(formatDuration(1234 * DAY)).toBe("1,234 days");
  });

  it("keeps the sign of a negative duration", () => {
    expect(formatDuration(-16 * MINUTE)).toBe("-16 min");
  });

  it("shows a dash for values that are not a duration", () => {
    expect(formatDuration(Number.NaN)).toBe(EMPTY_DURATION);
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe(EMPTY_DURATION);
  });
});
