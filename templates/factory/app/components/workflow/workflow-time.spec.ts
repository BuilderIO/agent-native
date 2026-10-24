import { describe, expect, it } from "vitest";

import { describeCron, formatRelativeTime } from "./workflow-time";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("reads past and future in the largest fitting unit", () => {
    expect(formatRelativeTime("2026-10-18T11:58:00.000Z", NOW, "en")).toBe(
      "2 min. ago",
    );
    expect(formatRelativeTime("2026-10-18T12:03:00.000Z", NOW, "en")).toBe(
      "in 3 min.",
    );
    expect(formatRelativeTime("2026-10-18T09:00:00.000Z", NOW, "en")).toBe(
      "3 hr. ago",
    );
    expect(formatRelativeTime("2026-10-16T12:00:00.000Z", NOW, "en")).toBe(
      "2 days ago",
    );
  });

  it("says now for the last few seconds", () => {
    expect(formatRelativeTime("2026-10-18T12:00:00.000Z", NOW, "en")).toBe(
      "now",
    );
  });

  it("accepts a timestamp in milliseconds", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW, "en")).toBe("1 min. ago");
  });

  it("gives nothing for an instant it cannot read", () => {
    expect(formatRelativeTime(null, NOW, "en")).toBeNull();
    expect(formatRelativeTime(undefined, NOW, "en")).toBeNull();
    expect(formatRelativeTime("", NOW, "en")).toBeNull();
    expect(formatRelativeTime("not a date", NOW, "en")).toBeNull();
  });
});

describe("describeCron", () => {
  it("reads the minute and hour steps a job is written with", () => {
    expect(describeCron("*/5 * * * *")).toEqual({
      kind: "minutes",
      minutes: 5,
    });
    expect(describeCron("0 * * * *")).toEqual({ kind: "hourly" });
    expect(describeCron("0 */6 * * *")).toEqual({ kind: "hours", hours: 6 });
  });

  it("reads clock times, daily, on weekdays and weekly", () => {
    expect(describeCron("0 8 * * *")).toEqual({ kind: "daily", time: "08:00" });
    expect(describeCron("30 9 * * 1-5")).toEqual({
      kind: "weekdays",
      time: "09:30",
    });
    expect(describeCron("0 7 * * 1")).toEqual({
      kind: "weekly",
      day: 1,
      time: "07:00",
    });
  });

  it("shows a cron it does not recognise as written", () => {
    expect(describeCron("0 8 1 * *")).toEqual({
      kind: "custom",
      cron: "0 8 1 * *",
    });
    expect(describeCron("0 8 * * 1,3")).toEqual({
      kind: "custom",
      cron: "0 8 * * 1,3",
    });
    expect(describeCron("* * *")).toEqual({ kind: "custom", cron: "* * *" });
  });

  it("is null when there is no schedule", () => {
    expect(describeCron(null)).toBeNull();
    expect(describeCron("  ")).toBeNull();
  });
});
