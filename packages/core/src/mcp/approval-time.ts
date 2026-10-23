/**
 * Times an MCP call names, read so the approval page and prompt can show
 * them in the reader's zone. A call gives a time either as an instant with
 * an offset (`2026-10-22T14:00:00-07:00`) or as a wall time with an IANA
 * zone beside it (`start` plus `startTimeZone`); a wall time with no zone
 * is ambiguous and stays as written.
 */

/** A point in time a call names, and the zone the call gave for it. */
export interface McpApprovalTime {
  at: number;
  /** An IANA zone, `UTC`, or a fixed offset such as `-07:00`. */
  zone: string;
}

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const FIXED_OFFSET = /^([+-])(\d{2}):?(\d{2})$/;
// Real offsets run from UTC-12:00 to UTC+14:00.
const MAX_OFFSET_MINUTES = 14 * 60;

/** Minutes ahead of UTC a fixed offset such as `-07:00` names, if it is a real one. */
function fixedOffsetMinutes(zone: string): number | undefined {
  const fixed = FIXED_OFFSET.exec(zone);
  if (!fixed || Number(fixed[3]) >= 60) return undefined;
  const minutes = Number(fixed[2]) * 60 + Number(fixed[3]);
  if (minutes > MAX_OFFSET_MINUTES) return undefined;
  return fixed[1] === "-" ? -minutes : minutes;
}

export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.trim()) return false;
  if (FIXED_OFFSET.test(zone)) return fixedOffsetMinutes(zone) !== undefined;
  if (zone === "UTC") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    // coercion-ok: a zone Intl rejects is not a zone; the value stays as written.
    return false;
  }
}

/** Minutes ahead of UTC that `zone` is at `at`. */
export function zoneOffsetMinutes(at: number, zone: string): number {
  const fixed = fixedOffsetMinutes(zone);
  if (fixed !== undefined) return fixed;
  if (zone === "UTC") return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall time names in `zone`, unless the zone skips it. A
 * spring-forward gap has no 2:30 AM, and which side of the gap the action
 * picks is up to it.
 */
function wallTimeInZone(wall: number, zone: string): number | undefined {
  // Twice, so a wall time beside a DST change lands on the right side of it.
  const guess = wall - zoneOffsetMinutes(wall, zone) * 60_000;
  const at = wall - zoneOffsetMinutes(guess, zone) * 60_000;
  return at + zoneOffsetMinutes(at, zone) * 60_000 === wall ? at : undefined;
}

function normalizedOffset(offset: string): string | undefined {
  if (offset.toUpperCase() === "Z") return "UTC";
  if (fixedOffsetMinutes(offset) === undefined) return undefined;
  const fixed = FIXED_OFFSET.exec(offset)!;
  return `${fixed[1]}${fixed[2]}:${fixed[3]}`;
}

/**
 * The wall time an `ISO_DATE_TIME` match names, as milliseconds read as if
 * it were UTC, when every field is in range. `Date.UTC` carries an
 * impossible field into the next one (month 13, 25:00), which would show a
 * different, plausible time.
 */
function wallTimeOf(match: RegExpExecArray): number | undefined {
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map(
    (group) => Number(match[group] ?? 0),
  ) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
    ? date.getTime()
    : undefined;
}

/**
 * The instant `value` names, when it is an ISO date-time that carries an
 * offset or comes with `zone`. `zone` wins as the label when both are given:
 * it is the zone the event lives in, the offset only pins the instant.
 */
export function readApprovalTime(
  value: string,
  zone: string | undefined,
): McpApprovalTime | undefined {
  const match = ISO_DATE_TIME.exec(value.trim());
  const wall = match ? wallTimeOf(match) : undefined;
  if (!match || wall === undefined) return undefined;
  if (match[7]) {
    const offset = normalizedOffset(match[7]);
    if (!offset) return undefined;
    return {
      at: wall - zoneOffsetMinutes(wall, offset) * 60_000,
      zone: zone ?? offset,
    };
  }
  const at = zone ? wallTimeInZone(wall, zone) : undefined;
  return zone && at !== undefined ? { at, zone } : undefined;
}

/**
 * The wall-clock time `value` names when it is an ISO date-time with no
 * offset, as milliseconds read as if it were UTC. Which instant it means is
 * up to the action, so it is shown as written and never converted.
 */
export function readWallTime(value: string): number | undefined {
  const match = ISO_DATE_TIME.exec(value.trim());
  if (!match || match[7]) return undefined;
  return wallTimeOf(match);
}

/** A wall time from `readWallTime`, with no zone named. */
export function formatWallTime(wall: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(wall));
}

function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  return `UTC${sign}${hours}:${String(absolute % 60).padStart(2, "0")}`;
}

/** A zone from `isTimeZone` by its name in `locale`, such as "Pacific Time". */
export function formatTimeZoneName(
  zone: string,
  locale: string,
  at = Date.now(),
): string {
  if (FIXED_OFFSET.test(zone)) return offsetLabel(zoneOffsetMinutes(at, zone));
  const nameIn = (timeZoneName: "longGeneric" | "long") =>
    new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName })
      .formatToParts(new Date(at))
      .find((part) => part.type === "timeZoneName")?.value;
  const generic = nameIn("longGeneric");
  // A zone with no generic name gets an offset ("GMT+00:00"); UTC has a
  // long name that says more.
  if (generic && !/^(?:GMT|UTC)(?:[+-]|$)/.test(generic)) return generic;
  return nameIn("long") ?? generic ?? zone;
}

/**
 * `at` as the reader sees it in `zone`, with the zone named. `time` is a
 * time of day; `date-time` adds the day; `date` is the day alone.
 */
export function formatApprovalTime(
  at: number,
  zone: string,
  locale: string,
  style: "time" | "date-time" | "date",
): string {
  const options: Intl.DateTimeFormatOptions =
    style === "date"
      ? { year: "numeric", month: "short", day: "numeric" }
      : style === "date-time"
        ? {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }
        : { hour: "numeric", minute: "2-digit" };
  if (FIXED_OFFSET.test(zone)) {
    const minutes = zoneOffsetMinutes(at, zone);
    const text = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "UTC",
    }).format(new Date(at + minutes * 60_000));
    return style === "date" ? text : `${text} ${offsetLabel(minutes)}`;
  }
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: zone,
    ...(style === "date" ? {} : { timeZoneName: "short" }),
  }).format(new Date(at));
}
