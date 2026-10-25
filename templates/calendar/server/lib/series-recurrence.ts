import type { CalendarEvent } from "../../shared/api.js";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_CODE_BY_LABEL: Record<string, (typeof DAY_CODES)[number]> = {
  Sun: "SU",
  Mon: "MO",
  Tue: "TU",
  Wed: "WE",
  Thu: "TH",
  Fri: "FR",
  Sat: "SA",
};

function isDateOnlyValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// An unrecognised provider zone behaves like no zone, matching googleDateWeekdayCode.
function knownTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    // coercion-ok: Intl's RangeError is the only test for a valid zone, and "unknown" deliberately means "no zone" here
    return undefined;
  }
}

function hasUtcOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

// Offset-less date-times are wall time in the series zone. Without a zone they
// are read as UTC wall time, so the result never depends on the server's zone.
function parseGoogleDateValue(value: string, timeZone?: string): Date {
  if (isDateOnlyValue(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  if (hasUtcOffset(value)) return new Date(value);
  const wall = Date.parse(`${value}Z`);
  if (Number.isNaN(wall)) return new Date(wall);
  const zone = knownTimeZone(timeZone);
  return new Date(zone ? instantFromZoneWall(wall, zone) : wall);
}

function googleDateWeekdayCode(
  value: string | undefined,
  timeZone?: string,
): (typeof DAY_CODES)[number] | undefined {
  if (!value) return undefined;
  const date = parseGoogleDateValue(value, timeZone);
  if (Number.isNaN(date.getTime())) return undefined;

  if (isDateOnlyValue(value)) {
    return DAY_CODES[date.getUTCDay()];
  }

  if (timeZone) {
    try {
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
      }).format(date);
      return DAY_CODE_BY_LABEL[label];
    } catch {
      // Fall through to UTC if Google returned an invalid timezone.
    }
  }

  return DAY_CODES[date.getUTCDay()];
}

function recurrenceField(rule: string, key: string): string | undefined {
  return rule.match(new RegExp(`(?:^|[:;])${key}=([^;]+)`))?.[1];
}

function replaceRecurrenceField(
  rule: string,
  key: string,
  value: string,
): string {
  const pattern = new RegExp(`(${key}=)[^;]+`);
  if (pattern.test(rule)) return rule.replace(pattern, `$1${value}`);
  return `${rule};${key}=${value}`;
}

function alignWeeklyRecurrenceDay(
  rule: string,
  oldDay: string,
  newDay: string,
): string {
  if (!rule.startsWith("RRULE:")) return rule;
  if (recurrenceField(rule, "FREQ") !== "WEEKLY") return rule;

  const byDay = recurrenceField(rule, "BYDAY");
  if (!byDay) return rule;

  const days = byDay.split(",");
  if (days.length === 1) {
    return replaceRecurrenceField(rule, "BYDAY", newDay);
  }
  if (!days.includes(oldDay) || days.includes(newDay)) return rule;

  return replaceRecurrenceField(
    rule,
    "BYDAY",
    days.map((day) => (day === oldDay ? newDay : day)).join(","),
  );
}

// Whole-second offsets only, so the instant's milliseconds carry through.
function zoneOffsetMs(instant: number, timeZone: string): number {
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
  const wallSeconds = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return wallSeconds - Math.floor(instant / 1000) * 1000;
}

// Compatible policy (Temporal disambiguation "compatible"): a wall time inside
// a spring-forward gap resolves forward by the gap length (02:30 -> 03:30), and
// an ambiguous fall-back wall time resolves to the earlier instant. Both use
// the offset in force before the transition. A single offset lookup on a
// guessed instant lands on whichever side of the gap the guess falls, so it
// silently resolves a gap backward.
function instantFromZoneWall(wall: number, timeZone: string): number {
  const dayMs = 86_400_000;
  const beforeOffset = zoneOffsetMs(wall - dayMs, timeZone);
  const afterOffset = zoneOffsetMs(wall + dayMs, timeZone);
  const beforeInstant = wall - beforeOffset;
  const afterInstant = wall - afterOffset;
  const beforeValid = zoneOffsetMs(beforeInstant, timeZone) === beforeOffset;
  const afterValid = zoneOffsetMs(afterInstant, timeZone) === afterOffset;
  if (beforeValid && afterValid) return Math.min(beforeInstant, afterInstant);
  if (afterValid) return afterInstant;
  return beforeInstant;
}

function zoneWallMs(instant: number, timeZone: string): number {
  return instant + zoneOffsetMs(instant, timeZone);
}

function shiftedZoneWallInstant(
  master: number,
  deltaMs: number,
  timeZone: string,
): number {
  return instantFromZoneWall(zoneWallMs(master, timeZone) + deltaMs, timeZone);
}

// `timeZone` is the master's zone. `nextTimeZone` is the zone the new value's
// offset-less wall time was typed in; it defaults to the master's zone.
export function shiftSeriesDateValue(
  nextValue: string | undefined,
  instanceValue: string | undefined,
  masterValue: string | undefined,
  timeZone?: string,
  nextTimeZone?: string,
): string | undefined {
  if (!nextValue || !instanceValue || !masterValue) return nextValue;
  const zone = knownTimeZone(timeZone);
  const nextZone = knownTimeZone(nextTimeZone ?? timeZone);
  const next = parseGoogleDateValue(nextValue, nextZone);
  const instance = parseGoogleDateValue(instanceValue, zone);
  const master = parseGoogleDateValue(masterValue, zone);
  if (
    Number.isNaN(next.getTime()) ||
    Number.isNaN(instance.getTime()) ||
    Number.isNaN(master.getTime())
  ) {
    return nextValue;
  }

  if (isDateOnlyValue(nextValue)) {
    const shifted = new Date(
      master.getTime() + (next.getTime() - instance.getTime()),
    );
    return shifted.toISOString().split("T")[0];
  }
  // The delta is the wall-clock gap the user edited, read in the new value's
  // zone; it is then applied to the master's wall clock in the master's zone.
  // Without a zone the delta is absolute time, which moves wall-clock time by
  // an hour across a DST change. Shifting wall-clock time needs the zone.
  const deltaMs = nextZone
    ? zoneWallMs(next.getTime(), nextZone) -
      zoneWallMs(instance.getTime(), nextZone)
    : next.getTime() - instance.getTime();
  const shiftedMs = zone
    ? shiftedZoneWallInstant(master.getTime(), deltaMs, zone)
    : master.getTime() + deltaMs;
  return new Date(shiftedMs).toISOString().replace(/\.000Z$/, "Z");
}

export function alignSeriesRecurrenceToStart(
  event: Partial<Pick<CalendarEvent, "start" | "startTimeZone" | "recurrence">>,
  master: {
    startValue?: string;
    startTimeZone?: string;
    recurrence?: string[];
  },
): Partial<Pick<CalendarEvent, "start" | "startTimeZone" | "recurrence">> {
  if (event.recurrence !== undefined || event.start === undefined) return event;
  if (!master.recurrence?.length) return event;

  const timeZone = event.startTimeZone || master.startTimeZone;
  const oldDay = googleDateWeekdayCode(
    master.startValue,
    master.startTimeZone || timeZone,
  );
  const newDay = googleDateWeekdayCode(event.start, timeZone);
  if (!oldDay || !newDay || oldDay === newDay) return event;

  const recurrence = master.recurrence.map((rule) =>
    alignWeeklyRecurrenceDay(rule, oldDay, newDay),
  );
  if (recurrence.every((rule, index) => rule === master.recurrence?.[index])) {
    return event;
  }

  return { ...event, recurrence };
}
