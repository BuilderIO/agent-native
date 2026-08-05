import { describe, expect, it } from "vitest";

import {
  friendlyAutomationScheduleToCron,
  isValidAutomationSchedule,
  parseFriendlyAutomationSchedule,
} from "./automation-schedule-fields.js";

describe("automation schedule fields", () => {
  it.each([
    ["15 * * * *", "hourly"],
    ["30 8 * * *", "daily"],
    ["0 9 * * 1-5", "weekdays"],
    ["0 9 * * MON-FRI", "weekdays"],
    ["45 17 * * 3", "weekly"],
    ["0 7 21 * *", "monthly"],
  ] as const)("parses friendly cron %s as %s", (cron, frequency) => {
    expect(parseFriendlyAutomationSchedule(cron)?.frequency).toBe(frequency);
  });

  it.each([
    "*/15 * * * *",
    "0 9,17 * * *",
    "0 9 * * 1,3,5",
    "0 9 1 6 *",
    "@midnight",
  ])("leaves valid but irregular cron in advanced mode: %s", (cron) => {
    expect(isValidAutomationSchedule(cron)).toBe(true);
    expect(parseFriendlyAutomationSchedule(cron)).toBeNull();
  });

  it("converts every friendly frequency to deterministic five-field cron", () => {
    const base = { hour: 8, minute: 5, weekday: 4, dayOfMonth: 12 };

    expect(
      friendlyAutomationScheduleToCron({ ...base, frequency: "hourly" }),
    ).toBe("5 * * * *");
    expect(
      friendlyAutomationScheduleToCron({ ...base, frequency: "daily" }),
    ).toBe("5 8 * * *");
    expect(
      friendlyAutomationScheduleToCron({ ...base, frequency: "weekdays" }),
    ).toBe("5 8 * * 1-5");
    expect(
      friendlyAutomationScheduleToCron({ ...base, frequency: "weekly" }),
    ).toBe("5 8 * * 4");
    expect(
      friendlyAutomationScheduleToCron({ ...base, frequency: "monthly" }),
    ).toBe("5 8 12 * *");
  });

  it("rejects invalid cron without treating it as a friendly schedule", () => {
    expect(isValidAutomationSchedule("99 99 * * *")).toBe(false);
    expect(parseFriendlyAutomationSchedule("99 99 * * *")).toBeNull();
  });
});
