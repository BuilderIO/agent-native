import { expect, it } from "vitest";

import {
  nextScheduleFire,
  normalizedScheduleCron,
  publishedAppScheduleConfig,
  scheduleIso,
  type ScheduleCadence,
} from "./published-app-schedules.js";

const zone = "Europe/Amsterdam";
function next(cadence: ScheduleCadence, after: string) {
  const due = nextScheduleFire(cadence, zone, new Date(after));
  return due ? scheduleIso(due) : null;
}

it("advances a weekday 09:00 schedule in Amsterdam across the weekend", () => {
  const cadence = { kind: "custom", cron: "0 9 * * 1-5" } as const;
  expect(next(cadence, "2026-11-18T07:59:00Z")).toBe("2026-11-18T08:00:00Z");
  expect(next(cadence, "2026-11-18T08:00:00Z")).toBe("2026-11-19T08:00:00Z");
  expect(next(cadence, "2026-11-20T08:00:00Z")).toBe("2026-11-23T08:00:00Z");
});

it("skips the DST gap and runs the first repeated local minute only once", () => {
  const cadence = { kind: "daily", hour: 2, minute: 30 } as const;
  expect(next(cadence, "2026-03-28T01:30:00Z")).toBe("2026-03-30T00:30:00Z");
  expect(next(cadence, "2026-10-24T00:30:00Z")).toBe("2026-10-25T00:30:00Z");
  expect(next(cadence, "2026-10-25T00:30:00Z")).toBe("2026-10-26T01:30:00Z");
  expect(next(cadence, "2026-10-25T01:00:00Z")).toBe("2026-10-26T01:30:00Z");
});

it("normalizes all five cadences, skips missing calendar days and honors cron day OR semantics", () => {
  expect(normalizedScheduleCron({ kind: "hourly", minute: 8 })).toBe(
    "8 * * * *",
  );
  expect(
    normalizedScheduleCron({ kind: "weekly", weekday: 1, hour: 9, minute: 2 }),
  ).toBe("2 9 * * 1");
  const monthEnd = { kind: "monthly", day: 31, hour: 9, minute: 0 } as const;
  expect(next(monthEnd, "2026-01-31T08:00:00Z")).toBe("2026-03-31T07:00:00Z");
  expect(
    next({ kind: "custom", cron: "0 9 31 * 1" }, "2026-02-01T08:00:00Z"),
  ).toBe("2026-02-02T08:00:00Z");
  expect(
    next({ kind: "custom", cron: "0 9 31 2 *" }, "2026-02-01T08:00:00Z"),
  ).toBeNull();
});

it("rejects a six-field cron, non-IANA zone and duplicate recipients", () => {
  const input = {
    cadence: { kind: "custom", cron: "0 9 * * 1-5" },
    timezone: zone,
    recipients: [],
  };
  expect(publishedAppScheduleConfig.parse(input)).toMatchObject({
    updatePublishedResults: true,
    useCachedSqlResults: false,
    target: "default",
  });
  expect(
    publishedAppScheduleConfig.safeParse({
      ...input,
      timezone: "Europe/Invalid",
    }).success,
  ).toBe(false);
  expect(
    publishedAppScheduleConfig.safeParse({
      ...input,
      cadence: { kind: "custom", cron: "0 0 9 * * 1-5" },
    }).success,
  ).toBe(false);
  expect(
    publishedAppScheduleConfig.safeParse({
      ...input,
      recipients: [{ memberId: "member" }, { memberId: "member" }],
    }).success,
  ).toBe(false);
});
