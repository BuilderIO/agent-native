import { TZDate } from "@date-fns/tz";
import { addMinutes as _addMinutes, differenceInMinutes } from "date-fns";

export function parseISO(iso: string): Date {
  return new Date(iso);
}

export function toISO(d: Date): string {
  return d.toISOString();
}

export function addMinutes(d: Date, minutes: number): Date {
  return _addMinutes(d, minutes);
}

export function minutesBetween(start: Date, end: Date): number {
  return differenceInMinutes(end, start);
}

export function zonedTimeToUtc(
  localDate: string,
  localTime: string,
  timezone: string,
): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const [h, mm] = localTime.split(":").map(Number);
  const tz = new TZDate(y, (m ?? 1) - 1, d ?? 1, h ?? 0, mm ?? 0, 0, timezone);
  return new Date(tz.getTime());
}

export function formatLocalDate(d: Date, timezone: string): string {
  const tz = new TZDate(d.getTime(), timezone);
  const yyyy = tz.getFullYear();
  const mm = String(tz.getMonth() + 1).padStart(2, "0");
  const dd = String(tz.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatLocalTime(d: Date, timezone: string): string {
  const tz = new TZDate(d.getTime(), timezone);
  const hh = String(tz.getHours()).padStart(2, "0");
  const mm = String(tz.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function getDayOfWeek(d: Date, timezone: string): number {
  const tz = new TZDate(d.getTime(), timezone);
  return tz.getDay();
}

export function overlaps(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && b.start < a.end;
}

export function clampRange(
  range: { start: Date; end: Date },
  window: { start: Date; end: Date },
): { start: Date; end: Date } | null {
  const start = range.start > window.start ? range.start : window.start;
  const end = range.end < window.end ? range.end : window.end;
  if (start >= end) return null;
  return { start, end };
}

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
  const endLocal = formatLocalDate(new Date(endUtc.getTime() - 1), timezone);
  if (out[out.length - 1] !== endLocal) out.push(endLocal);
  return out;
}
