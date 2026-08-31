import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOMATION_SCHEDULE_DRAFT,
  automationScheduleDraftFromCron,
  automationScheduleToCron,
} from "./automation-schedule.js";

describe("automation schedule builder", () => {
  it("turns friendly cadence choices into cron", () => {
    expect(
      automationScheduleToCron({
        ...DEFAULT_AUTOMATION_SCHEDULE_DRAFT,
        preset: "daily-noon",
      }),
    ).toEqual({ schedule: "0 12 * * *" });
    expect(
      automationScheduleToCron({
        ...DEFAULT_AUTOMATION_SCHEDULE_DRAFT,
        preset: "custom",
        unit: "month",
        interval: 2,
        monthDay: 15,
        time: "08:30",
      }),
    ).toEqual({ schedule: "30 8 15 */2 *" });
  });

  it("round-trips supported cron patterns and leaves advanced patterns alone", () => {
    const parsed = automationScheduleDraftFromCron("15 8 * * 0");
    expect(parsed.recognized).toBe(true);
    expect(parsed.draft).toMatchObject({
      preset: "weekly",
      time: "08:15",
      weekday: 0,
    });
    expect(automationScheduleDraftFromCron("0 9 1 * 1").recognized).toBe(false);
  });

  it("keeps unsupported multi-week cadence explicit for Advanced", () => {
    expect(
      automationScheduleToCron({
        ...DEFAULT_AUTOMATION_SCHEDULE_DRAFT,
        preset: "custom",
        unit: "week",
        interval: 2,
      }),
    ).toEqual({ error: "weekly-interval" });
  });
});
