import {
  FALLBACK_READER_LOCALE,
  formatLocaleDate,
} from "@agent-native/toolkit/app/shared/reader-locale";

/**
 * The reference's date filter opens a calendar: a month grid with its own
 * previous/next month controls, seven weekday columns and one button per day, for
 * a single day and for both ends of a range. These rules build that grid as plain
 * data so the component only draws it.
 *
 * Days are ISO `yyyy-mm-dd` strings read as UTC midnight, the same shape the
 * filter already stores, so a click never shifts a day across a timezone.
 */

const DAY_MS = 86_400_000;
/** Six weeks cover every month, so the grid's height never jumps. */
export const GRID_CELLS = 42;

function utcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function isoDayFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isDay(day: string | null | undefined): day is string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = utcMs(day);
  return Number.isFinite(at) && isoDayFromDate(new Date(at)) === day;
}

export function todayDay(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(day: string, count: number): string {
  return isoDayFromDate(new Date(utcMs(day) + count * DAY_MS));
}

/** First day of the month `day` falls in. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(month: string, count: number): string {
  const start = monthStart(month);
  const year = Number(start.slice(0, 4));
  const index = Number(start.slice(5, 7)) - 1 + count;
  const shifted = new Date(Date.UTC(year, index, 1));
  return `${shifted.toISOString().slice(0, 7)}-01`;
}

/**
 * The grid for one month: six rows of seven days, starting on the Sunday of the
 * week that holds the first, which is the week order the reference's calendar
 * draws. Cells outside the month are kept so the grid stays rectangular; the
 * caller decides whether to show them.
 */
export function monthGrid(
  month: string,
): Array<{ day: string; inMonth: boolean }> {
  const start = monthStart(month);
  const first = new Date(utcMs(start));
  // getUTCDay(): 0 is Sunday, so this backs up to the Sunday the week begins on.
  const lead = first.getUTCDay();
  const gridStart = addDays(start, -lead);
  return Array.from({ length: GRID_CELLS }, (_, index) => {
    const day = addDays(gridStart, index);
    return { day, inMonth: day.slice(0, 7) === start.slice(0, 7) };
  });
}

/** Month and year as the calendar heads it, in the reader's own locale. */
export function monthLabel(
  month: string,
  locale: string = FALLBACK_READER_LOCALE,
): string {
  return formatLocaleDate(monthStart(month), locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Seven weekday headings, Sunday first, in the reader's own locale. */
export function weekdayLabels(
  locale: string = FALLBACK_READER_LOCALE,
): string[] {
  // 2024-01-07 is a Sunday, so index 0 is the first column.
  const sunday = "2024-01-07";
  return Array.from({ length: 7 }, (_, index) =>
    formatLocaleDate(addDays(sunday, index), locale, {
      weekday: "short",
      timeZone: "UTC",
    }),
  );
}

export type DayState =
  | "none"
  | "selected"
  | "range-start"
  | "range-end"
  | "in-range";

/** How one day cell sits against the picked day or the picked range. */
export function dayState(
  day: string,
  range: { from: string; to: string } | null,
): DayState {
  const from = range?.from && isDay(range.from) ? range.from : null;
  const to = range?.to && isDay(range.to) ? range.to : null;
  if (!from || day < from || day > (to ?? from)) return "none";
  if (from === (to ?? from)) return "selected";
  if (day === from) return "range-start";
  if (day === to) return "range-end";
  return "in-range";
}

/**
 * The day a click picks, for each mode. After and Before take a single day, so a
 * click replaces it. Between takes a first and a last day: the first click starts
 * a new range, the second closes it (in either order), and a third starts over.
 */
export function nextRangeForClick(
  day: string,
  mode: "after" | "before" | "between",
  current: { from: string; to: string } | null,
): { from: string; to: string } {
  if (mode !== "between") return { from: day, to: day };
  const from = current?.from && isDay(current.from) ? current.from : null;
  const to = current?.to && isDay(current.to) ? current.to : null;
  if (!from || (from && to)) return { from: day, to: "" };
  return from <= day ? { from, to: day } : { from: day, to: from };
}
