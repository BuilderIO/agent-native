import { describe, expect, it } from "vitest";

import {
  describeCron,
  effectiveTimezone,
  isValidTimezone,
  nextOccurrence,
  serverTimezone,
} from "./cron.js";

const NOON_UTC = new Date("2026-07-31T12:00:00Z");

describe("timezone-aware cron", () => {
  it("resolves a wall-clock hour in the schedule's own zone", () => {
    expect(
      nextOccurrence("0 8 * * *", NOON_UTC, "America/New_York").toISOString(),
    ).toBe("2026-08-01T12:00:00.000Z");
    expect(nextOccurrence("0 8 * * *", NOON_UTC, "UTC").toISOString()).toBe(
      "2026-08-01T08:00:00.000Z",
    );
  });

  it("keeps a schedule stored before timezone support host-relative", () => {
    expect(nextOccurrence("0 8 * * *", NOON_UTC).toISOString()).toBe(
      nextOccurrence("0 8 * * *", NOON_UTC, serverTimezone()).toISOString(),
    );
  });

  it("falls back to the host zone for an unusable timezone", () => {
    expect(effectiveTimezone("Not/AZone")).toBe(serverTimezone());
    expect(effectiveTimezone(null)).toBe(serverTimezone());
    expect(effectiveTimezone("America/New_York")).toBe("America/New_York");
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });

  it("names the zone on any description that carries a clock time", () => {
    expect(describeCron("0 8 * * *", "America/New_York")).toBe(
      "Every day at 8 AM (America/New_York)",
    );
    expect(describeCron("0 9 * * 1-5", "Europe/Berlin")).toBe(
      "Every weekday at 9 AM (Europe/Berlin)",
    );
    expect(describeCron("30 6 1 * *", "UTC")).toBe(
      "On day 1 of every month at 6:30 AM (UTC)",
    );
  });

  it("leaves descriptions without a clock time unlabelled", () => {
    expect(describeCron("* * * * *", "America/New_York")).toBe("Every minute");
    expect(describeCron("*/15 * * * *", "America/New_York")).toBe(
      "Every 15 minutes",
    );
  });
});
