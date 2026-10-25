import * as fc from "fast-check";
import { RRule, rrulestr } from "rrule";
import { describe, expect, it } from "vitest";

import {
  buildCustomRecurrenceRules,
  buildRecurrenceRules,
  type CustomRecurrenceDraft,
} from "../../app/lib/event-form-utils";
import {
  alignSeriesRecurrenceToStart,
  shiftSeriesDateValue,
} from "./series-recurrence";

// Reference: RFC 5545 recurrence expansion in the event's local wall-clock time,
// as implemented by the rrule library. rrule's own TZID path reads the process
// time zone (the same DTSTART gives different instants under TZ=UTC and
// TZ=Asia/Tokyo), so occurrences are expanded as wall-clock values and mapped
// back to instants with Intl here.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const RUNS = { numRuns: 200 };
const OCCURRENCES = 20;

const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
type Code = (typeof CODES)[number];
const ZONES = ["America/New_York", "Europe/Berlin", "Asia/Tokyo"] as const;
type Zone = (typeof ZONES)[number];

const RRULE_WEEKDAY: Record<Code, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

const DAY_MIN = Date.UTC(2020, 0, 1) / DAY_MS;
const DAY_MAX = Date.UTC(2035, 11, 31) / DAY_MS;

function zoneWall(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
}

function offsetAt(instant: number, timeZone: string): number {
  return zoneWall(instant, timeZone) - instant;
}

function instantFromWall(wall: number, timeZone: string): number {
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
}

function isoWithOffset(instant: number, timeZone: string): string {
  const wall = zoneWall(instant, timeZone);
  const offsetMinutes = Math.round((wall - instant) / MINUTE_MS);
  const abs = Math.abs(offsetMinutes);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const hh = String(Math.trunc(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${new Date(wall).toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

function dstTransitionDays(zone: Zone): number[] {
  const days: number[] = [];
  for (let day = DAY_MIN + 1; day <= DAY_MAX; day++) {
    const today = offsetAt(day * DAY_MS + 12 * HOUR_MS, zone);
    const yesterday = offsetAt((day - 1) * DAY_MS + 12 * HOUR_MS, zone);
    if (today !== yesterday) days.push(day);
  }
  return days;
}

const DST_DAYS: Record<Zone, number[]> = {
  "America/New_York": dstTransitionDays("America/New_York"),
  "Europe/Berlin": dstTransitionDays("Europe/Berlin"),
  "Asia/Tokyo": [],
};

// Transition days whose offset rises: the 02:00-03:00 wall hour does not exist.
// Computed once here; the generator must not rescan the calendar per sample.
function isSpringForward(day: number, zone: Zone): boolean {
  return (
    offsetAt(day * DAY_MS + 12 * HOUR_MS, zone) >
    offsetAt((day - 1) * DAY_MS + 12 * HOUR_MS, zone)
  );
}

const SPRING_FORWARD_DAYS: Record<Zone, number[]> = {
  "America/New_York": DST_DAYS["America/New_York"].filter((day) =>
    isSpringForward(day, "America/New_York"),
  ),
  "Europe/Berlin": DST_DAYS["Europe/Berlin"].filter((day) =>
    isSpringForward(day, "Europe/Berlin"),
  ),
  "Asia/Tokyo": [],
};

function compactUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function compactDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

function weekdayOf(wall: number): Code {
  const code: Code | undefined = CODES[new Date(wall).getUTCDay()];
  if (code === undefined) throw new Error("getUTCDay outside 0-6");
  return code;
}

function bydayOf(rule: string): string[] {
  return (rule.match(/BYDAY=([^;]+)/)?.[1] ?? "").split(",");
}

type Moment = { wall: number; value: string };

function momentAt(wall: number, timeZone: Zone | undefined): Moment {
  if (timeZone === undefined) {
    return { wall, value: new Date(wall).toISOString().slice(0, 10) };
  }
  return {
    wall,
    value: isoWithOffset(instantFromWall(wall, timeZone), timeZone),
  };
}

function untilInstant(rule: string): number | undefined {
  const match = rule.match(/;UNTIL=(\d{4})(\d{2})(\d{2})T235959Z/);
  if (!match) return undefined;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    23,
    59,
    59,
  );
}

// Expands in wall-clock time with UNTIL removed: UNTIL is an absolute instant,
// so it is applied after each occurrence is mapped back to its zone.
function rawWalls(rule: string, startWall: number): number[] {
  const body = rule.replace(/^RRULE:/, "").replace(/;UNTIL=[^;]*/, "");
  return rrulestr(`DTSTART:${compactUtc(startWall)}\nRRULE:${body}`)
    .all((_, i) => i < 200)
    .map((date) => date.getTime());
}

function boundedWalls(
  walls: number[],
  rule: string,
  timeZone: Zone | undefined,
): number[] {
  const until = untilInstant(rule);
  const kept =
    until === undefined
      ? walls
      : walls.filter(
          (wall) =>
            (timeZone ? instantFromWall(wall, timeZone) : wall) <= until,
        );
  return kept;
}

function occurrences(
  rule: string,
  startWall: number,
  timeZone: Zone | undefined,
): number[] {
  return boundedWalls(rawWalls(rule, startWall), rule, timeZone).slice(
    0,
    OCCURRENCES,
  );
}

function tailFrom(walls: number[], boundary: number): number[] {
  return walls.filter((wall) => wall >= boundary).slice(0, OCCURRENCES);
}

const zoneArb = fc.constantFrom(...ZONES);
const zonePairArb = fc.constantFrom(
  ...ZONES.flatMap((a) =>
    ZONES.filter((b) => b !== a).map((b) => [a, b] as const),
  ),
);
const codeArb = fc.constantFrom(...CODES);

function dayArb(zone: Zone): fc.Arbitrary<number> {
  const random = fc.integer({ min: DAY_MIN, max: DAY_MAX });
  const dst = DST_DAYS[zone];
  return dst.length > 0 ? fc.oneof(random, fc.constantFrom(...dst)) : random;
}

// Local wall-clock start, 06:00-20:59. Avoids DST gaps (a non-existent wall
// time has no instant to round-trip through).
function wallArb(zone: Zone, allDay: boolean): fc.Arbitrary<number> {
  return fc
    .tuple(
      dayArb(zone),
      fc.integer({ min: 6, max: 20 }),
      fc.constantFrom(0, 15, 30, 45),
    )
    .map(([day, hour, minute]) =>
      allDay
        ? day * DAY_MS
        : day * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS,
    );
}

type End =
  | { kind: "count"; count: number }
  | { kind: "until"; offsetDays: number };

const endArb: fc.Arbitrary<End> = fc.oneof(
  fc
    .integer({ min: 1, max: 30 })
    .map((count): End => ({ kind: "count", count })),
  // UNTIL is 60 to 400 days after the master start, so it never precedes the
  // moved start (shifts are at most 40 days).
  fc
    .integer({ min: 60, max: 400 })
    .map((offsetDays): End => ({ kind: "until", offsetDays })),
);

function weeklyRule(
  interval: number,
  days: readonly Code[],
  end: End,
  masterWall: number,
): string {
  const parts = [
    "FREQ=WEEKLY",
    ...(interval > 1 ? [`INTERVAL=${interval}`] : []),
    `BYDAY=${days.join(",")}`,
  ];
  if (end.kind === "count") {
    parts.push(`COUNT=${end.count}`);
  } else {
    const untilMs =
      Math.floor(masterWall / DAY_MS) * DAY_MS + end.offsetDays * DAY_MS;
    parts.push(`UNTIL=${compactDate(untilMs)}T235959Z`);
  }
  return `RRULE:${parts.join(";")}`;
}

type SeriesCase = {
  zone: Zone | undefined;
  master: Moment;
  masterCode: Code;
  days: Code[];
  interval: number;
  end: End;
  rule: string;
  shiftDays: number;
};

function seriesArb(
  intervalArb: fc.Arbitrary<number>,
  daysFor: (masterCode: Code, extra: Code[]) => Code[],
  endFor: fc.Arbitrary<End> = endArb,
): fc.Arbitrary<SeriesCase> {
  return fc.tuple(zoneArb, fc.boolean()).chain(([zone, allDay]) =>
    fc
      .tuple(
        wallArb(zone, allDay),
        intervalArb,
        fc.uniqueArray(codeArb, { maxLength: 6 }),
        endFor,
        fc.integer({ min: -40, max: 40 }),
      )
      .map(([masterWall, interval, extra, end, shiftDays]) => {
        const tz = allDay ? undefined : zone;
        const masterCode = weekdayOf(masterWall);
        const days = daysFor(masterCode, extra);
        return {
          zone: tz,
          master: momentAt(masterWall, tz),
          masterCode,
          days,
          interval,
          end,
          rule: weeklyRule(interval, days, end, masterWall),
          shiftDays,
        };
      }),
  );
}

// Realistic series: the start falls on one of its own BYDAY days.
const multiDaySeries = seriesArb(
  fc.integer({ min: 1, max: 4 }),
  (masterCode, extra) =>
    CODES.filter((code) => code === masterCode || extra.includes(code)),
);
const singleDaySeries = seriesArb(
  fc.integer({ min: 1, max: 4 }),
  (masterCode) => [masterCode],
);
const multiDayWeekly1Series = (end: fc.Arbitrary<End>) =>
  seriesArb(
    fc.constant(1),
    (masterCode, extra) =>
      CODES.filter((code) => code === masterCode || extra.includes(code)),
    end,
  );
const untilOnlyArb: fc.Arbitrary<End> = fc
  .integer({ min: 60, max: 400 })
  .map((offsetDays): End => ({ kind: "until", offsetDays }));

function alignedRule(
  series: SeriesCase,
  start: Moment,
  eventZone: Zone | undefined = series.zone,
): string {
  const aligned = alignSeriesRecurrenceToStart(
    {
      start: start.value,
      ...(eventZone ? { startTimeZone: eventZone } : {}),
    },
    {
      startValue: series.master.value,
      ...(series.zone ? { startTimeZone: series.zone } : {}),
      recurrence: [series.rule],
    },
  );
  return aligned.recurrence?.[0] ?? series.rule;
}

const movedWall = (series: SeriesCase) =>
  series.master.wall + series.shiftDays * DAY_MS;

describe("alignSeriesRecurrenceToStart against the RFC 5545 expansion", () => {
  it("keeps the moved start as the first occurrence of the aligned series", () => {
    fc.assert(
      fc.property(multiDaySeries, (series) => {
        const start = momentAt(movedWall(series), series.zone);
        const rule = alignedRule(series, start);
        expect(occurrences(rule, start.wall, series.zone)[0]).toBe(start.wall);
      }),
      RUNS,
    );
  });

  it("keeps every occurrence on a BYDAY weekday of the aligned rule", () => {
    fc.assert(
      fc.property(multiDaySeries, (series) => {
        const start = momentAt(movedWall(series), series.zone);
        const rule = alignedRule(series, start);
        const days = bydayOf(rule);
        for (const wall of occurrences(rule, start.wall, series.zone)) {
          expect(days).toContain(weekdayOf(wall));
        }
      }),
      RUNS,
    );
  });

  it("moves a single-weekday series as a whole: every occurrence shifts by the start delta", () => {
    fc.assert(
      fc.property(singleDaySeries, (series) => {
        const start = momentAt(movedWall(series), series.zone);
        const rule = alignedRule(series, start);
        const expected = boundedWalls(
          rawWalls(series.rule, series.master.wall).map(
            (wall) => wall + series.shiftDays * DAY_MS,
          ),
          series.rule,
          series.zone,
        ).slice(0, OCCURRENCES);
        expect(occurrences(rule, start.wall, series.zone)).toEqual(expected);
      }),
      RUNS,
    );
  });

  it("moves only the start weekday's occurrences of a multi-day weekly series, after both starts", () => {
    fc.assert(
      fc.property(multiDayWeekly1Series(untilOnlyArb), (series) => {
        const start = momentAt(movedWall(series), series.zone);
        fc.pre(!series.days.includes(weekdayOf(start.wall)));
        const rule = alignedRule(series, start);
        const shift = series.shiftDays * DAY_MS;
        const mapped = rawWalls(series.rule, series.master.wall)
          .map((wall) =>
            weekdayOf(wall) === series.masterCode ? wall + shift : wall,
          )
          .sort((a, b) => a - b);
        const boundary = Math.max(series.master.wall, start.wall);
        expect(
          tailFrom(
            boundedWalls(rawWalls(rule, start.wall), rule, series.zone),
            boundary,
          ),
        ).toEqual(
          tailFrom(boundedWalls(mapped, series.rule, series.zone), boundary),
        );
      }),
      { ...RUNS, maxSkipsPerRun: 2000 },
    );
  });

  // oracle finding: moving a multi-day series start past its other weekdays adds occurrences the series never had.
  // oracle-change: documented open policy finding (multi-day BYDAY extent); flips to it() when the policy is decided
  it.fails("never adds an occurrence the original series did not have", () => {
    fc.assert(
      fc.property(multiDayWeekly1Series(endArb), (series) => {
        const start = momentAt(movedWall(series), series.zone);
        fc.pre(!series.days.includes(weekdayOf(start.wall)));
        const rule = alignedRule(series, start);
        const shift = series.shiftDays * DAY_MS;
        const mapped = rawWalls(series.rule, series.master.wall).map((wall) =>
          weekdayOf(wall) === series.masterCode ? wall + shift : wall,
        );
        for (const wall of occurrences(rule, start.wall, series.zone)) {
          expect(mapped).toContain(wall);
        }
      }),
      { ...RUNS, maxSkipsPerRun: 2000 },
    );
  });

  it("uses the moved start's weekday in the new time zone when the time zone changes too", () => {
    fc.assert(
      fc.property(
        zonePairArb,
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: DAY_MIN, max: DAY_MAX }),
        fc.integer({ min: -2, max: 2 }),
        fc.integer({ min: 0, max: 23 }),
        fc.constantFrom(0, 30),
        endArb,
        ([fromZone, toZone], interval, day, dayDelta, hour, minute, end) => {
          const masterWall = day * DAY_MS + 9 * HOUR_MS;
          const masterCode = weekdayOf(masterWall);
          const series: SeriesCase = {
            zone: fromZone,
            master: momentAt(masterWall, fromZone),
            masterCode,
            days: [masterCode],
            interval,
            end,
            rule: weeklyRule(interval, [masterCode], end, masterWall),
            shiftDays: dayDelta,
          };
          const start = momentAt(
            (day + dayDelta) * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS,
            toZone,
          );
          const rule = alignedRule(series, start, toZone);
          expect(occurrences(rule, start.wall, toZone)[0]).toBe(start.wall);
        },
      ),
      RUNS,
    );
  });
});

describe("shiftSeriesDateValue", () => {
  const shiftCaseArb = fc.tuple(zoneArb, fc.boolean()).chain(([zone, allDay]) =>
    fc
      .tuple(
        wallArb(zone, allDay),
        fc.integer({ min: DAY_MIN, max: DAY_MAX }),
        fc.integer({ min: -60, max: 60 }),
      )
      .map(([masterWall, instanceDay, shiftDays]) => {
        const tz = allDay ? undefined : zone;
        const timeOfDay = masterWall - Math.floor(masterWall / DAY_MS) * DAY_MS;
        const instanceWall = instanceDay * DAY_MS + timeOfDay;
        return {
          zone: tz,
          master: momentAt(masterWall, tz),
          instance: momentAt(instanceWall, tz),
          next: momentAt(instanceWall + shiftDays * DAY_MS, tz),
        };
      }),
  );

  it("keeps all-day values date-only and timed values date-time", () => {
    fc.assert(
      fc.property(shiftCaseArb, ({ zone, master, instance, next }) => {
        const shifted = shiftSeriesDateValue(
          next.value,
          instance.value,
          master.value,
        );
        if (zone === undefined) {
          expect(shifted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        } else {
          expect(shifted).toContain("T");
          expect(Number.isNaN(Date.parse(shifted ?? ""))).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("round-trips: shifting by +d and then by -d returns the master", () => {
    fc.assert(
      fc.property(shiftCaseArb, ({ zone, master, instance, next }) => {
        const forward = shiftSeriesDateValue(
          next.value,
          instance.value,
          master.value,
        );
        const back = shiftSeriesDateValue(instance.value, next.value, forward);
        if (zone === undefined) {
          expect(back).toBe(master.value);
        } else {
          expect(Date.parse(back ?? "")).toBe(Date.parse(master.value));
        }
      }),
      RUNS,
    );
  });

  it("keeps a timed master's wall-clock time across a DST transition", () => {
    fc.assert(
      fc.property(
        shiftCaseArb.filter((c) => c.zone !== undefined),
        ({ zone, master, next, instance }) => {
          const shifted = shiftSeriesDateValue(
            next.value,
            instance.value,
            master.value,
            zone,
          );
          const shiftedWall = zoneWall(
            Date.parse(shifted ?? ""),
            zone ?? "UTC",
          );
          expect(shiftedWall).toBe(master.wall + (next.wall - instance.wall));
        },
      ),
      RUNS,
    );
  });

  // Compatible policy (Temporal disambiguation "compatible"): a wall time in a
  // spring-forward gap moves forward by the gap length; an ambiguous fall-back
  // wall time takes the earlier instant.
  it("moves a master at 02:30 onto a spring-forward gap to 03:30 (America/New_York)", () => {
    expect(
      shiftSeriesDateValue(
        "2026-03-08T06:00:00-04:00",
        "2026-03-01T06:00:00-05:00",
        "2026-03-01T02:30:00-05:00",
        "America/New_York",
      ),
    ).toBe("2026-03-08T07:30:00Z");
  });

  it("moves a master at 02:30 onto a spring-forward gap to 03:30 (Europe/Berlin)", () => {
    expect(
      shiftSeriesDateValue(
        "2026-03-29T06:00:00+02:00",
        "2026-03-22T06:00:00+01:00",
        "2026-03-22T02:30:00+01:00",
        "Europe/Berlin",
      ),
    ).toBe("2026-03-29T01:30:00Z");
  });

  it("resolves a fall-back overlap wall time to the earlier (EDT) instant (America/New_York)", () => {
    expect(
      shiftSeriesDateValue(
        "2026-11-01T06:00:00-05:00",
        "2026-10-25T06:00:00-04:00",
        "2026-10-25T01:30:00-04:00",
        "America/New_York",
      ),
    ).toBe("2026-11-01T05:30:00Z");
  });

  it("moves any wall time inside a spring-forward gap forward by the gap length", () => {
    const springGapArb = fc
      .constantFrom<Zone>("America/New_York", "Europe/Berlin")
      .chain((zone) =>
        fc
          .tuple(
            fc.constantFrom(...SPRING_FORWARD_DAYS[zone]),
            fc.integer({ min: 0, max: 59 }),
          )
          .map(([day, minute]) => ({ zone, day, minute })),
      );
    fc.assert(
      fc.property(springGapArb, ({ zone, day, minute }) => {
        // The master sits on the same wall time one week earlier, so the shift
        // (+7 days) lands it on 02:mm of the transition day.
        const gapWall = day * DAY_MS + 2 * HOUR_MS + minute * MINUTE_MS;
        const master = momentAt(
          (day - 7) * DAY_MS + 2 * HOUR_MS + minute * MINUTE_MS,
          zone,
        );
        const instance = momentAt((day - 7) * DAY_MS + 6 * HOUR_MS, zone);
        const next = momentAt(day * DAY_MS + 6 * HOUR_MS, zone);
        const shifted = shiftSeriesDateValue(
          next.value,
          instance.value,
          master.value,
          zone,
        );
        expect(zoneWall(Date.parse(shifted ?? ""), zone)).toBe(
          gapWall + HOUR_MS,
        );
      }),
      RUNS,
    );
  });
});

describe("app-produced RRULE strings", () => {
  const customDraftArb: fc.Arbitrary<CustomRecurrenceDraft> = fc
    .tuple(
      fc.integer({ min: 1, max: 4 }),
      fc.uniqueArray(codeArb, { minLength: 1, maxLength: 7 }),
      fc.oneof(
        fc.constant({ endMode: "never" as const, endDate: "", count: 13 }),
        fc
          .integer({ min: 1, max: 60 })
          .map((count) => ({ endMode: "count" as const, endDate: "", count })),
        fc.integer({ min: DAY_MIN, max: DAY_MAX }).map((day) => ({
          endMode: "date" as const,
          endDate: new Date(day * DAY_MS).toISOString().slice(0, 10),
          count: 13,
        })),
      ),
    )
    .map(([interval, days, end]) => ({
      interval,
      unit: "week",
      days: [...days],
      ...end,
    }));

  it("builds custom weekly rules that parse back to the drafted interval, days, and end", () => {
    fc.assert(
      fc.property(customDraftArb, (draft) => {
        const rule: string | undefined = buildCustomRecurrenceRules(draft)[0];
        if (rule === undefined) throw new Error("no custom recurrence rule");
        const parsed = RRule.fromString(rule).options;
        expect(parsed.freq).toBe(RRule.WEEKLY);
        expect(parsed.interval).toBe(draft.interval);
        const byweekday = (parsed.byweekday ?? []).map(Number);
        // rrule numbers weekdays from MO = 0, unlike CODES which starts at SU.
        expect([...byweekday].sort((a, b) => a - b)).toEqual(
          draft.days
            .map((code) => RRULE_WEEKDAY[code as Code])
            .sort((a, b) => a - b),
        );
        expect(parsed.count ?? null).toBe(
          draft.endMode === "count" ? draft.count : null,
        );
        expect(parsed.until?.toISOString() ?? null).toBe(
          draft.endMode === "date" ? `${draft.endDate}T23:59:59.000Z` : null,
        );
      }),
      RUNS,
    );
  });

  it("builds presets whose frequency, interval, and weekday match the name, and whose weekly first occurrence is the start", () => {
    const presetFreq = {
      daily: RRule.DAILY,
      weekdays: RRule.WEEKLY,
      weekly: RRule.WEEKLY,
      biweekly: RRule.WEEKLY,
      monthly: RRule.MONTHLY,
      yearly: RRule.YEARLY,
    } as const;
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...(Object.keys(presetFreq) as (keyof typeof presetFreq)[]),
        ),
        zoneArb,
        fc.boolean(),
        fc.integer({ min: DAY_MIN, max: DAY_MAX }),
        fc.integer({ min: 6, max: 20 }),
        (preset, zone, allDay, day, hour) => {
          const tz = allDay ? undefined : zone;
          const wall = allDay ? day * DAY_MS : day * DAY_MS + hour * HOUR_MS;
          const start = momentAt(wall, tz);
          const rules = buildRecurrenceRules(preset, start.value, tz);
          expect(rules).not.toBeNull();
          const [rule] = rules ?? [];
          const parsed = RRule.fromString(rule ?? "").options;
          expect(parsed.freq).toBe(presetFreq[preset]);
          expect(parsed.interval).toBe(preset === "biweekly" ? 2 : 1);
          if (preset === "weekdays") {
            expect([...(parsed.byweekday ?? [])].map(Number).sort()).toEqual([
              0, 1, 2, 3, 4,
            ]);
          }
          if (preset === "weekly" || preset === "biweekly") {
            expect(occurrences(rule ?? "", wall, tz)[0]).toBe(wall);
          }
        },
      ),
      RUNS,
    );
  });
});
