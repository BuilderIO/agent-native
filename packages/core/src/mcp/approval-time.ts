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

export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.trim()) return false;
  if (FIXED_OFFSET.test(zone) || zone === "UTC") return true;
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
  const fixed = FIXED_OFFSET.exec(zone);
  if (fixed) {
    const minutes = Number(fixed[2]) * 60 + Number(fixed[3]);
    return fixed[1] === "-" ? -minutes : minutes;
  }
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

function wallTimeInZone(wall: number, zone: string): number {
  // Twice, so a wall time beside a DST change lands on the right side of it.
  const guess = wall - zoneOffsetMinutes(wall, zone) * 60_000;
  return wall - zoneOffsetMinutes(guess, zone) * 60_000;
}

function normalizedOffset(offset: string): string {
  if (offset.toUpperCase() === "Z") return "UTC";
  const fixed = FIXED_OFFSET.exec(offset)!;
  return `${fixed[1]}${fixed[2]}:${fixed[3]}`;
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
  if (!match) return undefined;
  const wall = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
  if (!Number.isFinite(wall)) return undefined;
  if (match[7]) {
    const offset = normalizedOffset(match[7]);
    return {
      at: wall - zoneOffsetMinutes(wall, offset) * 60_000,
      zone: zone ?? offset,
    };
  }
  return zone ? { at: wallTimeInZone(wall, zone), zone } : undefined;
}

/**
 * The wall-clock time `value` names when it is an ISO date-time with no
 * offset, as milliseconds read as if it were UTC. Which instant it means is
 * up to the action, so it is shown as written and never converted.
 */
export function readWallTime(value: string): number | undefined {
  const match = ISO_DATE_TIME.exec(value.trim());
  if (!match || match[7]) return undefined;
  const wall = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
  return Number.isFinite(wall) ? wall : undefined;
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
