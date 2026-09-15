import { describe, expect, it } from "vitest";

import { describeCron, isValidCron, nextOccurrence } from "./cron.js";

describe("isValidCron", () => {
  it("accepts standard 5-field expressions", () => {
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("*/30 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
  });

  it("rejects garbage and out-of-range fields", () => {
    expect(isValidCron("not a cron")).toBe(false);
    expect(isValidCron("99 99 * * *")).toBe(false);
    // Whitespace-only parses as a 1-field expr and trips a range constraint.
    expect(isValidCron("   ")).toBe(false);
  });

  it("normalizes the @midnight alias that cron-parser v5 mishandles", () => {
    // The whole reason ALIAS_MAP exists: without normalization cron-parser
    // would throw on "@midnight". With it, the alias validates.
    expect(isValidCron("@midnight")).toBe(true);
    expect(isValidCron("  @MIDNIGHT  ")).toBe(true);
  });
});

describe("nextOccurrence", () => {
  // cron-parser interprets the cron fields in the runtime's local timezone, so
  // assert with local-time getters to stay timezone-agnostic across CI hosts.
  it("computes the next matching time strictly after the anchor", () => {
    // Anchor before today's 09:00 local; expect today at 09:00 local.
    const after = new Date("2026-01-15T00:00:00");
    after.setHours(8, 0, 0, 0);
    const next = nextOccurrence("0 9 * * *", after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(15);
  });

  it("rolls to the next day when the anchor is past today's time", () => {
    const after = new Date("2026-01-15T00:00:00");
    after.setHours(10, 0, 0, 0);
    const next = nextOccurrence("0 9 * * *", after);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(9);
  });

  it("honors the @midnight alias as 0 0 * * *", () => {
    const after = new Date("2026-03-10T00:00:00");
    after.setHours(12, 34, 0, 0);
    const next = nextOccurrence("@midnight", after);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(11);
  });

  it("advances on each successive call when fed its own output", () => {
    const start = new Date("2026-01-01T00:00:00");
    const first = nextOccurrence("*/15 * * * *", start);
    const second = nextOccurrence("*/15 * * * *", first);
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(second.getTime() - first.getTime()).toBe(15 * 60_000);
  });
});

describe("describeCron", () => {
  it("describes every-minute and every-N-minutes", () => {
    expect(describeCron("* * * * *")).toBe("Every minute");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("*/30 * * * *")).toBe("Every 30 minutes");
  });

  it("describes hourly schedules with zero-padded minutes", () => {
    expect(describeCron("0 * * * *")).toBe("Every hour at :00");
    expect(describeCron("5 * * * *")).toBe("Every hour at :05");
  });

  it("describes a daily schedule with 12-hour AM/PM time", () => {
    expect(describeCron("0 9 * * *")).toBe("Every day at 9 AM");
    expect(describeCron("30 14 * * *")).toBe("Every day at 2:30 PM");
    // midnight (hour 0) renders as 12 AM, noon as 12 PM.
    expect(describeCron("0 0 * * *")).toBe("Every day at 12 AM");
    expect(describeCron("0 12 * * *")).toBe("Every day at 12 PM");
  });

  it("describes weekday schedules for both 1-5 and MON-FRI", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Every weekday at 9 AM");
    expect(describeCron("0 9 * * MON-FRI")).toBe("Every weekday at 9 AM");
  });

  it("describes a specific day-of-week with its English name", () => {
    expect(describeCron("0 9 * * 1")).toBe("Every Monday at 9 AM");
    // 0 and 7 both mean Sunday.
    expect(describeCron("0 9 * * 0")).toBe("Every Sunday at 9 AM");
    expect(describeCron("0 9 * * 7")).toBe("Every Sunday at 9 AM");
  });

  it("describes a specific day-of-month schedule", () => {
    expect(describeCron("0 9 15 * *")).toBe("On day 15 of every month at 9 AM");
  });

  it("joins multiple hours with 'and'", () => {
    // Exercises the multi-hour formatTime branch (hours.join(" and ")).
    expect(describeCron("0 9,17 * * *")).toBe("Every day at 9 AM and 5 PM");
  });

  it("joins multiple days-of-week with commas", () => {
    // Exercises the comma-separated day-of-week branch (days.join(", ")).
    expect(describeCron("0 9 * * 1,3,5")).toBe(
      "Every Monday, Wednesday, Friday at 9 AM",
    );
  });

  it("falls back to the raw expression for shapes it can't describe", () => {
    // Wrong field count returns the raw input verbatim.
    expect(describeCron("0 9 * *")).toBe("0 9 * *");
    // A month-constrained expression isn't matched by any branch.
    expect(describeCron("0 9 1 6 *")).toBe("0 9 1 6 *");
  });

  it("describes @midnight via the alias map", () => {
    expect(describeCron("@midnight")).toBe("Every day at 12 AM");
  });
});
