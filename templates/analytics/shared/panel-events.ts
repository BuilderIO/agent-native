import type { PanelEvent } from "../app/pages/adhoc/sql-dashboard/types";
import { isSafeSvgHexColor } from "./svg-color";

export interface ResolvedPanelEvent {
  index: number;
  x: string;
  xValue: string | number;
  date: string;
  time?: string;
  timeZone?: string;
  label: string;
  color?: string;
}

/** Events that land on the same x value draw as one marker. */
export interface PanelEventGroup {
  index: number;
  x: string;
  xValue: string | number;
  events: ResolvedPanelEvent[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

/** A real "YYYY-MM-DD" day. Date.parse rolls 2026-02-30 over to March 2 instead of rejecting it. */
export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    zoneClock(value);
    return true;
    // coercion-ok: Intl's RangeError is its only signal for an unknown zone.
  } catch {
    return false; // coercion-ok: false is this validator's "invalid" answer.
  }
}

/** What is wrong with `value` as an event, or null when it is a valid one. */
export function panelEventProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "must be an object";
  }
  const { date, label, color, time, timeZone } = value as Record<
    string,
    unknown
  >;
  if (typeof date !== "string" || !isIsoCalendarDate(date)) {
    return 'date must be a real "YYYY-MM-DD" day';
  }
  if (typeof label !== "string" || label.trim() === "") {
    return "label must be a non-empty string";
  }
  if (color !== undefined && !isSafeSvgHexColor(color)) {
    return "color must be a 3, 4, 6, or 8 digit hex color";
  }
  if (time === undefined) {
    return timeZone === undefined ? null : "timeZone needs a time";
  }
  if (typeof time !== "string" || !TIME_OF_DAY.test(time)) {
    return 'time must be a 24-hour "HH:MM"';
  }
  if (timeZone === undefined) return null;
  if (!isValidTimeZone(timeZone)) {
    return "timeZone must be an IANA zone, such as America/New_York";
  }
  return zonedInstant(eventWallTime({ date, time }), timeZone) === null
    ? nonexistentTimeProblem({ date, time, timeZone })
    : null;
}

export function isValidPanelEvent(value: unknown): value is PanelEvent {
  return panelEventProblem(value) === null;
}

const zoneClocks = new Map<string, Intl.DateTimeFormat>();

/**
 * One formatter per zone: building one costs far more than formatting with it.
 * Intl takes a zone in any letter case, so keep each under its canonical name;
 * keyed by what a caller typed, validating input could grow this without end.
 */
function zoneClock(timeZone: string): Intl.DateTimeFormat {
  let clock = zoneClocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zoneClocks.set(clock.resolvedOptions().timeZone, clock);
  }
  return clock;
}

/** Milliseconds a zone's wall clock is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    zoneClock(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a zone's clocks read `wall` (a wall time written as UTC ms), or
 * null when they skip it springing forward. A time they read twice falling
 * back resolves to the earlier instant: 01:30 on New York's November change
 * day is 01:30 EDT, not EST.
 */
function zonedInstant(wall: number, timeZone: string): number | null {
  // The offsets a day either side are the ones in force around any change.
  const shown = [wall - DAY_MS, wall + DAY_MS]
    .map((probe) => wall - zoneOffsetMs(probe, timeZone))
    .filter((instant) => instant + zoneOffsetMs(instant, timeZone) === wall);
  return shown.length > 0 ? Math.min(...shown) : null;
}

function eventWallTime(event: Pick<PanelEvent, "date" | "time">): number {
  const base = Date.parse(event.date);
  if (!event.time) return base;
  const [hours, minutes] = event.time.split(":").map(Number);
  return base + (hours * 60 + minutes) * 60_000;
}

function nonexistentTimeProblem(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
): string {
  return `time ${event.time} does not exist on ${event.date} in ${event.timeZone}: the clocks skip it for daylight saving`;
}

/** The UTC instant of an event's date and time of day in its time zone. */
export function panelEventInstant(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
): number {
  const wall = eventWallTime(event);
  if (!event.time || !event.timeZone) return wall;
  const instant = zonedInstant(wall, event.timeZone);
  if (instant === null) throw new RangeError(nonexistentTimeProblem(event));
  return instant;
}

/** Numeric x values are Unix epoch milliseconds, matching JavaScript Date. */
export function xInstant(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (ISO_DATE.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  if (!ISO_DATE.test(text.slice(0, 10))) return null;
  // SQL timestamps without a zone are UTC; Date.parse would read them as local.
  const normalized = text.replace(" ", "T");
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) ? ms : null;
}

/** Each distinct point once, ascending, with the first position that holds it. */
interface SortedPoints {
  values: number[];
  first: number[];
}

function sortPoints(points: readonly number[]): SortedPoints {
  const order = points
    .map((_, position) => position)
    .sort((a, b) => points[a] - points[b] || a - b);
  const sorted: SortedPoints = { values: [], first: [] };
  for (const position of order) {
    if (sorted.values[sorted.values.length - 1] === points[position]) continue;
    sorted.values.push(points[position]);
    sorted.first.push(position);
  }
  return sorted;
}

/** The index of the last value at or before `target`, or -1 when none is. */
function lastAtOrBefore(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle - 1;
  }
  return high;
}

/** The nearest point; of two equally near, the one written first. */
function nearestPoint({ values, first }: SortedPoints, target: number): number {
  const below = lastAtOrBefore(values, target);
  if (below < 0) return first[0];
  if (below === values.length - 1 || values[below] === target) {
    return first[below];
  }
  const gapBelow = target - values[below];
  const gapAbove = values[below + 1] - target;
  if (gapBelow === gapAbove) return Math.min(first[below], first[below + 1]);
  return gapBelow < gapAbove ? first[below] : first[below + 1];
}

/** An event marks the bucket it falls in: 3:50 belongs to 3:00, not the nearer 4:00. */
function containingBucket(
  { values, first }: SortedPoints,
  target: number,
): number {
  const at = lastAtOrBefore(values, target);
  return at < 0 ? -1 : first[at];
}

/** The earliest row written on each day. */
function firstRowsByDay(
  rows: readonly { instant: number; day: number }[],
): Map<number, number> {
  const byDay = new Map<number, number>();
  rows.forEach((entry, position) => {
    const best = byDay.get(entry.day);
    if (best === undefined || entry.instant < rows[best].instant) {
      byDay.set(entry.day, position);
    }
  });
  return byDay;
}

/**
 * The calendar day an x value is written on, as UTC ms. A zoned timestamp
 * keeps its own date: local midnight east of UTC is the previous UTC day.
 */
function xDay(value: unknown, instant: number): number {
  return typeof value === "string"
    ? Date.parse(value.trim().slice(0, 10))
    : Math.floor(instant / DAY_MS) * DAY_MS;
}

/** A row whose x is a date: the instant it names and the calendar day it is written on. */
export interface XDatePoint {
  row: number;
  instant: number;
  day: number;
}

/** The rows whose x `toInstant` reads as a date, skipping a null bucket or a total row. */
export function xDatePoints(
  xValues: readonly unknown[],
  toInstant: (value: unknown) => number | null = xInstant,
): XDatePoint[] {
  return xValues.flatMap((x, row) => {
    const instant = toInstant(x);
    return instant === null ? [] : [{ row, instant, day: xDay(x, instant) }];
  });
}

/**
 * How much time each x value stands for: the shortest step between points
 * on an axis with several a day, otherwise whole calendar days or months.
 */
export type XCadence =
  | { unit: "time"; step: number }
  | { unit: "days" | "months"; count: number };

/** A bucket size an x column can name. */
export type XGrain = "day" | "week" | "month" | "quarter" | "year";

const GRAIN_CADENCE: Record<XGrain, XCadence> = {
  day: { unit: "days", count: 1 },
  week: { unit: "days", count: 7 },
  month: { unit: "months", count: 1 },
  quarter: { unit: "months", count: 3 },
  year: { unit: "months", count: 12 },
};

const GRAIN_WORDS = new Set<string>(Object.keys(GRAIN_CADENCE));

function xColumnWords(xKey: string): string[] {
  return xKey
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((word) => word.replace(/s$/, ""));
}

/**
 * The grain an x column's name gives: "day", "signup_week", "monthStart".
 * Null when it names none, or more than one. A column named `date` names
 * none, since queries write weekly and monthly buckets under that name too.
 */
export function xColumnGrain(xKey: string): XGrain | null {
  const grains = new Set(
    xColumnWords(xKey).filter((word) => GRAIN_WORDS.has(word)),
  );
  return grains.size === 1 ? ([...grains][0] as XGrain) : null;
}

/** Whether an x column's name, like "week_ending" or "monthEnd", dates each bucket by its last day. */
export function xColumnDatesBucketEnds(xKey: string): boolean {
  return xColumnWords(xKey).some((word) => word === "end" || word === "ending");
}

/**
 * Cadence comes from the grain the x column names, and otherwise from the
 * calendar dates the points fall on, not the gaps between them: local
 * midnights 23 or 25 hours apart across a daylight-saving change are still
 * one point a day, and days a query returned no row for do not stretch the
 * points either side. Points all on the first of a month step by months, or
 * by quarters or years when they are all whole quarters or whole years
 * apart, points all on one weekday by weeks, and anything else, or a lone
 * point, by days. Several points a day step by the shortest gap between them
 * in time order, whatever the column says, so rows sorted by value don't
 * stretch a point into the next day.
 */
export function xCadence(
  points: readonly XDatePoint[],
  grain: XGrain | null = null,
): XCadence {
  const days = [...new Set(points.map((point) => point.day))];
  if (new Set(points.map((point) => point.instant)).size > days.length) {
    const instants = points.map((point) => point.instant).sort((a, b) => a - b);
    const gaps = instants
      .slice(1)
      .map((instant, index) => instant - instants[index])
      .filter((gap) => gap > 0);
    return { unit: "time", step: Math.min(...gaps) };
  }
  if (grain) return GRAIN_CADENCE[grain];
  if (days.length < 2) return { unit: "days", count: 1 };
  const dates = days.map((day) => new Date(day));
  if (dates.every((date) => date.getUTCDate() === 1)) {
    const months = dates.map((date) => date.getUTCMonth());
    const count = months.every((month) => month === months[0])
      ? 12
      : months.every((month) => month % 3 === months[0] % 3)
        ? 3
        : 1;
    return { unit: "months", count };
  }
  const weekday = dates[0].getUTCDay();
  const weekly = dates.every((date) => date.getUTCDay() === weekday);
  return { unit: "days", count: weekly ? 7 : 1 };
}

/** The bucket whose last day is `day`: that many days up to it, or its months. */
export function xBucketEndingOn(
  cadence: Exclude<XCadence, { unit: "time" }>,
  day: number,
): { start: number; end: number } {
  if (cadence.unit === "days") {
    const end = day + DAY_MS;
    return { start: end - cadence.count * DAY_MS, end };
  }
  const date = new Date(day);
  const next = date.getUTCMonth() + 1;
  return {
    start: Date.UTC(date.getUTCFullYear(), next - cadence.count, 1),
    end: Date.UTC(date.getUTCFullYear(), next, 1),
  };
}

/** Where the bucket starting at `start` ends, exclusive. */
export function xBucketEnd(cadence: XCadence, start: number): number {
  if (cadence.unit === "time") return start + cadence.step;
  if (cadence.unit === "days") return start + cadence.count * DAY_MS;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + cadence.count, 1);
}

/**
 * Snaps each event to the nearest x value. Daily axes match on the event's
 * date. On an axis with several points per day, a timed event marks the
 * bucket its instant falls in, and an untimed one the first row written on
 * its date, or nothing when no row is. Rows whose x is not a date (a null
 * bucket, a total row) are skipped; events outside the x range, and x axes
 * with no dates at all, resolve to nothing.
 */
export function resolvePanelEvents(
  events: unknown,
  xValues: readonly unknown[],
): ResolvedPanelEvent[] {
  if (!Array.isArray(events)) return [];
  const rows = xDatePoints(xValues);
  if (rows.length === 0) return [];
  const cadence = xCadence(rows);
  const subDaily = cadence.unit === "time";
  const points = rows.map((entry) => (subDaily ? entry.instant : entry.day));
  const min = Math.min(...points);
  const max = Math.max(...points);
  const step = subDaily ? cadence.step : 0;
  const sorted = sortPoints(points);
  const firstRowByDay = firstRowsByDay(rows);
  // An event's instant is under two days from its date's midnight in any
  // zone, so a date further than that outside the axis cannot land on a row.
  const earliest = min - 2 * DAY_MS;
  const latest = max + step + 2 * DAY_MS;

  const rowFor = (event: PanelEvent): number => {
    // Not UTC midnight: on offset rows that is an hour of another day, and in
    // a window that starts later in the day it is before the first row.
    if (subDaily && !event.time) {
      return firstRowByDay.get(Date.parse(event.date)) ?? -1;
    }
    const target = subDaily ? panelEventInstant(event) : Date.parse(event.date);
    if (target < min || target >= max + Math.max(step, 1)) return -1;
    return subDaily
      ? containingBucket(sorted, target)
      : nearestPoint(sorted, target);
  };

  const resolved: ResolvedPanelEvent[] = [];
  for (const event of events) {
    // Most of a long key-date list falls outside any one chart: skip those
    // on their date alone, before validating them.
    const date = event?.date;
    if (typeof date !== "string") continue;
    const day = Date.parse(date);
    if (Number.isNaN(day) || day < earliest || day > latest) continue;
    if (!isValidPanelEvent(event)) continue;
    const best = rowFor(event);
    if (best < 0) continue;
    const { row } = rows[best];
    const xValue = xValues[row];
    if (typeof xValue !== "string" && typeof xValue !== "number") continue;
    resolved.push({
      index: row,
      x: String(xValue),
      xValue,
      date: event.date,
      ...(event.time ? { time: event.time } : {}),
      ...(event.timeZone ? { timeZone: event.timeZone } : {}),
      label: event.label,
      ...(event.color ? { color: event.color } : {}),
    });
  }
  return resolved;
}

/** Groups resolved events by x value, each group in time order. */
export function groupPanelEvents(
  resolved: readonly ResolvedPanelEvent[],
): PanelEventGroup[] {
  const groups = new Map<number, PanelEventGroup>();
  for (const event of resolved) {
    const group = groups.get(event.index);
    if (group) group.events.push(event);
    else
      groups.set(event.index, {
        index: event.index,
        x: event.x,
        xValue: event.xValue,
        events: [event],
      });
  }
  return [...groups.values()]
    .sort((a, b) => a.index - b.index)
    .map((group) => ({
      ...group,
      events: [...group.events].sort(
        (a, b) => panelEventInstant(a) - panelEventInstant(b),
      ),
    }));
}

const EVENT_DATE_PARTS = {
  month: "short",
  day: "numeric",
  year: "numeric",
} as const;

function formatTimedEvent(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
  withDate: boolean,
  locale: string | undefined,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...(withDate ? EVENT_DATE_PARTS : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.timeZone ?? "UTC",
    ...(event.timeZone ? { timeZoneName: "shortGeneric" as const } : {}),
  }).format(panelEventInstant(event));
}

/** "3:01 AM ET" for a timed event, in its own time zone; null without a time. */
export function formatPanelEventTime(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
  locale?: string,
): string | null {
  return event.time ? formatTimedEvent(event, false, locale) : null;
}

/**
 * When an event happened, in a list headed by `headerDate`: its time, with its
 * own date in front whenever that is another day ("Oct 13, 2026, 3:01 AM ET").
 * A weekly or monthly point gathers several days' events under one header.
 * Null for an untimed event on the header's date.
 */
export function formatPanelEventWhen(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
  headerDate: string,
  locale?: string,
): string | null {
  const withDate = event.date !== headerDate;
  if (event.time) return formatTimedEvent(event, withDate, locale);
  return withDate ? formatPanelEventDate(event.date, locale) : null;
}

/** "Oct 14, 2026" for an event's date. */
export function formatPanelEventDate(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    ...EVENT_DATE_PARTS,
    timeZone: "UTC",
  }).format(Date.parse(date));
}
