import { describe, expect, it } from "vitest";

import { nextDailyRunAt } from "./dashboard-report-subscriptions";

describe("dashboard report subscriptions", () => {
  it("schedules the next daily run in UTC", () => {
    expect(
      nextDailyRunAt("09:00", "UTC", new Date("2026-01-01T08:00:00.000Z")),
    ).toBe("2026-01-01T09:00:00.000Z");
  });

  it("rolls over when today's local send time has already passed", () => {
    expect(
      nextDailyRunAt(
        "09:00",
        "America/Los_Angeles",
        new Date("2026-01-01T18:00:00.000Z"),
      ),
    ).toBe("2026-01-02T17:00:00.000Z");
  });
});
