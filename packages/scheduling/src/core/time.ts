/**
 * DST-safe time math.
 *
 * Rules:
 *   - Never use raw `Date` arithmetic for anything timezone-aware.
 *   - Always work in UTC internally; convert at the edges.
 *   - Date strings are ISO-8601 (UTC). Local-day strings are "YYYY-MM-DD".
 *   - Times of day are "HH:MM" (24h, no seconds).
 *   - Timezones are IANA identifiers like "America/Los_Angeles".
 */
import { TZDate } from "@date-fns/tz";
import { addMinutes as _addMinutes, differenceInMinutes } from "date-fns";

/** Parse an ISO 8601 string to a UTC Date. */
export function parseISO(iso: string): Date {
  return new Date(iso);
}

/** Format a Date to an ISO 8601 UTC string ending in "Z". */
export function toISO(d: Date): string {
  return d.toISOString();
}

/** Add minutes to a Date (UTC-safe; DST-safe because we stay in UTC). */
export function addMinutes(d: Date, minutes: number): Date {
  return _addMinutes(d, minutes);
}

/** Minutes between two Dates (end - start). Can be negative. */
export function minutesBetween(start: Date, end: Date): number {
  return differenceInMinutes(end, start);
}

/**
 * Build a UTC Date from a local date + time of day + timezone.
 *
 * Example:
 *   zonedTimeToUtc("2026-04-04", "09:00", "America/Los_Angeles")
 *   → Date where UTC hour depends on whether PDT or PST is active.
 */
export function zonedTimeToUtc(
  localDate: string,
  localTime: string,
  timezone: string,
): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const [h, mm] = localTime.split(":").map(Number);
  // TZDate constructor takes local-in-timezone components and produces a
  // Date whose UTC value is correct for that wall-clock time in `timezone`.
  const tz = new TZDate(y, (m ?? 1) - 1, d ?? 1, h ?? 0, mm ?? 0, 0, timezone);
  return new Date(tz.getTime());
}

/** Format a UTC Date into a "YYYY-MM-DD" string in the target timezone. */
export function formatLocalDate(d: Date, timezone: string): string {
  const tz = new TZDate(d.getTime(), timezone);
  const yyyy = tz.getFullYear();
  const mm = String(tz.getMonth() + 1).padStart(2, "0");
  const dd = String(tz.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Format a UTC Date into a "HH:MM" string in the target timezone. */
export function formatLocalTime(d: Date, timezone: string): string {
  const tz = new TZDate(d.getTime(), timezone);
  const hh = String(tz.getHours()).padStart(2, "0");
  const mm = String(tz.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Day of week (0=Sun, 6=Sat) for a UTC Date in the target timezone. */
export function getDayOfWeek(d: Date, timezone: string): number {
  const tz = new TZDate(d.getTime(), timezone);
  return tz.getDay();
}

/** True if two intervals overlap (end-exclusive). */
export function overlaps(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Clamp a date range to a window. Returns null if they don't intersect. */
export function clampRange(
  range: { start: Date; end: Date },
  window: { start: Date; end: Date },
): { start: Date; end: Date } | null {
  const start = range.start > window.start ? range.start : window.start;
  const end = range.end < window.end ? range.end : window.end;
  if (start >= end) return null;
  return { start, end };
}

/**
 * Iterate UTC Date objects from start (inclusive) to end (exclusive) by
 * stepping `stepMinutes`. Safe across DST because we never touch local time.
 */
export function* steppedDates(
  start: Date,
  end: Date,
  stepMinutes: number,
): Generator<Date> {
  let cursor = new Date(start.getTime());
  while (cursor < end) {
    yield cursor;
    cursor = addMinutes(cursor, stepMinutes);
  }
}

/**
 * Enumerate "YYYY-MM-DD" local dates in `timezone` from `startUtc` to `endUtc`.
 * Useful for iterating per-day availability over a booking window.
 */
export function localDatesInRange(
  startUtc: Date,
  endUtc: Date,
  timezone: string,
): string[] {
  const out: string[] = [];
  let cursor = startUtc;
  let last = "";
  while (cursor < endUtc) {
    const d = formatLocalDate(cursor, timezone);
    if (d !== last) {
      out.push(d);
      last = d;
    }
    cursor = addMinutes(cursor, 60);
  }
  // Include final local day even if loop stopped exactly at midnight boundary
  const endLocal = formatLocalDate(new Date(endUtc.getTime() - 1), timezone);
  if (out[out.length - 1] !== endLocal) out.push(endLocal);
  return out;
}
