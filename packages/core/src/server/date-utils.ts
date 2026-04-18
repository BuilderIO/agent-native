/**
 * Timezone-aware date helpers for actions.
 *
 * The motivating case: a user at 6pm PT logs a meal. If the server computes
 * "today" with `new Date()`, it sees UTC (already past midnight) and stores
 * the entry as tomorrow. `todayInTimezone()` formats today in the caller's
 * timezone instead.
 *
 * Prefer `todayInTimezone()` over inline `new Date().toISOString().slice(0,10)`
 * or `new Date().getFullYear()` constructions when storing a `YYYY-MM-DD` date
 * column that represents the user's local day.
 */
import { getRequestTimezone } from "./request-context.js";

/**
 * Format a `Date` as `YYYY-MM-DD` in the given IANA timezone.
 *
 * Uses `Intl.DateTimeFormat` with the `en-CA` locale because it natively
 * emits `YYYY-MM-DD` order, which avoids reassembling parts by hand. Falls
 * back to the host timezone if `tz` is omitted.
 */
export function formatDateInTimezone(date: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Return today's date as `YYYY-MM-DD` in the given IANA timezone.
 * If `tz` is omitted, falls back to `getRequestTimezone()` (set from the
 * `x-user-timezone` header on action requests), then to the host timezone.
 */
export function todayInTimezone(tz?: string): string {
  return formatDateInTimezone(new Date(), tz ?? getRequestTimezone());
}
