/**
 * Booking limits enforcement.
 *
 * Limits constrain how many bookings an event type can receive in a time
 * window (day / week / month / year). We pass in existing booking counts
 * per bucket and return a function that tells us whether a proposed start
 * time would exceed any limit.
 */
import type { BookingLimits } from "../shared/index.js";
import { TZDate } from "@date-fns/tz";
import { startOfWeek, startOfMonth, startOfYear, format } from "date-fns";

export interface BookingCounts {
  perDay: Record<string, number>;
  perWeek: Record<string, number>;
  perMonth: Record<string, number>;
  perYear: Record<string, number>;
}

export function bucketKeysForSlot(
  slotStart: Date,
  timezone: string,
  weekStartsOn: 0 | 1 = 0,
): { day: string; week: string; month: string; year: string } {
  const local = new TZDate(slotStart.getTime(), timezone);
  const day = format(local, "yyyy-MM-dd");
  const week = format(startOfWeek(local, { weekStartsOn }), "yyyy-MM-dd");
  const month = format(startOfMonth(local), "yyyy-MM");
  const year = format(startOfYear(local), "yyyy");
  return { day, week, month, year };
}

export function exceedsLimits(
  slotStart: Date,
  timezone: string,
  limits: BookingLimits | undefined,
  counts: BookingCounts,
  weekStartsOn: 0 | 1 = 0,
): boolean {
  if (!limits) return false;
  const keys = bucketKeysForSlot(slotStart, timezone, weekStartsOn);
  if (limits.perDay != null && (counts.perDay[keys.day] ?? 0) >= limits.perDay)
    return true;
  if (
    limits.perWeek != null &&
    (counts.perWeek[keys.week] ?? 0) >= limits.perWeek
  )
    return true;
  if (
    limits.perMonth != null &&
    (counts.perMonth[keys.month] ?? 0) >= limits.perMonth
  )
    return true;
  if (
    limits.perYear != null &&
    (counts.perYear[keys.year] ?? 0) >= limits.perYear
  )
    return true;
  return false;
}
