import { describe, expect, it } from "vitest";

import { computeRunWindow, previousScheduledInstant } from "./window.js";

const NEW_YORK = "America/New_York";

describe("previousScheduledInstant", () => {
  it("steps back one period for an interval schedule", () => {
    expect(
      previousScheduledInstant(
        { every: "15m" },
        "UTC",
        new Date("2026-10-19T12:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-19T11:45:00.000Z");
  });

  it("reads Monday's weekday digest back to Friday morning in the schedule's own zone", () => {
    // Monday 2026-10-19 08:00 in New York is 12:00Z (EDT); Friday 08:00 is 12:00Z on the 16th.
    expect(
      previousScheduledInstant(
        { weekdays: { at: "08:00" } },
        NEW_YORK,
        new Date("2026-10-19T12:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-16T12:00:00.000Z");
  });

  it("steps back one day for a daily schedule and skips none", () => {
    expect(
      previousScheduledInstant(
        { daily: { at: "07:00" } },
        "America/Los_Angeles",
        new Date("2026-10-19T14:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-18T14:00:00.000Z");
  });

  it("finds the latest scheduled instant before a manual run, not the one a day earlier", () => {
    // 10:00 in New York on Monday: today's 08:00 already passed, so the window starts there.
    expect(
      previousScheduledInstant(
        { weekdays: { at: "08:00" } },
        NEW_YORK,
        new Date("2026-10-19T14:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-19T12:00:00.000Z");
  });

  it("follows a weekly schedule to the same weekday", () => {
    // Sundays are day 0; 2026-10-18 is a Sunday.
    expect(
      previousScheduledInstant(
        { weekly: { day: 0, at: "09:30" } },
        "UTC",
        new Date("2026-10-18T09:30:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-11T09:30:00.000Z");
  });

  it("keeps wall-clock time across a daylight-saving change", () => {
    // New York leaves daylight time on 2026-11-01: 08:00 is 12:00Z before and 13:00Z after.
    expect(
      previousScheduledInstant(
        { daily: { at: "08:00" } },
        NEW_YORK,
        new Date("2026-11-02T13:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-11-01T13:00:00.000Z");
    expect(
      previousScheduledInstant(
        { daily: { at: "08:00" } },
        NEW_YORK,
        new Date("2026-11-01T13:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-31T12:00:00.000Z");
  });
});

describe("computeRunWindow", () => {
  const end = new Date("2026-10-19T12:00:00.000Z");
  const schedule = { weekdays: { at: "08:00" } } as const;

  it("starts at the stored last-trigger time, not at now minus a period", () => {
    const result = computeRunWindow({
      schedule,
      timeZone: NEW_YORK,
      lastTriggerAt: "2026-10-14T12:00:00.000Z",
      end,
    });
    expect(result).toEqual({
      ok: true,
      window: {
        start: "2026-10-14T12:00:00.000Z",
        end: "2026-10-19T12:00:00.000Z",
        firstRun: false,
      },
    });
  });

  it("looks back one schedule period on the first run", () => {
    const result = computeRunWindow({
      schedule,
      timeZone: NEW_YORK,
      lastTriggerAt: null,
      end,
    });
    expect(result).toEqual({
      ok: true,
      window: {
        start: "2026-10-16T12:00:00.000Z",
        end: "2026-10-19T12:00:00.000Z",
        firstRun: true,
      },
    });
  });

  it("uses the workflow's own lookback on the first run when it sets one", () => {
    const result = computeRunWindow({
      schedule,
      timeZone: NEW_YORK,
      lastTriggerAt: null,
      end,
      lookbackMinutes: 90,
    });
    expect(result).toMatchObject({
      ok: true,
      window: { start: "2026-10-19T10:30:00.000Z", firstRun: true },
    });
  });

  it("refuses a last-trigger time after the window's end", () => {
    const result = computeRunWindow({
      schedule,
      timeZone: NEW_YORK,
      lastTriggerAt: "2026-10-20T12:00:00.000Z",
      end,
    });
    expect(result).toMatchObject({ ok: false });
  });
});
