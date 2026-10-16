import type { PanelEvent } from "../app/pages/adhoc/sql-dashboard/types";

export interface ResolvedPanelEvent {
  index: number;
  x: string;
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
    new Intl.DateTimeFormat("en-US", { timeZone: value });
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
  if (color !== undefined && typeof color !== "string") {
    return "color must be a string";
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

/** Milliseconds a zone's wall clock is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
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

function xInstant(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (ISO_DATE.test(text)) return Date.parse(text);
  if (!ISO_DATE.test(text.slice(0, 10))) return null;
  // SQL timestamps without a zone are UTC; Date.parse would read them as local.
  const normalized = text.replace(" ", "T");
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) ? ms : null;
}

function nearestPoint(points: readonly number[], target: number): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i] - target) < Math.abs(points[best] - target))
      best = i;
  }
  return best;
}

/** An event marks the bucket it falls in: 3:50 belongs to 3:00, not the nearer 4:00. */
function containingBucket(points: readonly number[], target: number): number {
  let best = -1;
  for (let i = 0; i < points.length; i++) {
    if (points[i] <= target && (best < 0 || points[i] > points[best])) best = i;
  }
  return best;
}

/** The earliest row written on `day`, or -1 when no row is. */
function firstRowOfDay(
  rows: readonly { instant: number; day: number }[],
  day: number,
): number {
  let best = -1;
  for (let i = 0; i < rows.length; i++) {
    if (
      rows[i].day === day &&
      (best < 0 || rows[i].instant < rows[best].instant)
    )
      best = i;
  }
  return best;
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
  const rows = xValues.flatMap((x, row) => {
    const instant = xInstant(x);
    return instant === null ? [] : [{ row, instant, day: xDay(x, instant) }];
  });
  if (rows.length === 0) return [];
  // Cadence comes from calendar dates, not gaps: local midnights 23 or 25
  // hours apart across a daylight-saving change are still one point a day.
  const subDaily =
    new Set(rows.map((entry) => entry.instant)).size >
    new Set(rows.map((entry) => entry.day)).size;
  const points = rows.map((entry) => (subDaily ? entry.instant : entry.day));
  const min = Math.min(...points);
  const max = Math.max(...points);
  const step = subDaily
    ? Math.min(
        ...points
          .slice(1)
          .map((point, index) => Math.abs(point - points[index]))
          .filter((gap) => gap > 0),
      )
    : 0;

  const rowFor = (event: PanelEvent): number => {
    // Not UTC midnight: on offset rows that is an hour of another day, and in
    // a window that starts later in the day it is before the first row.
    if (subDaily && !event.time) {
      return firstRowOfDay(rows, Date.parse(event.date));
    }
    const target = subDaily ? panelEventInstant(event) : Date.parse(event.date);
    if (target < min || target >= max + Math.max(step, 1)) return -1;
    return subDaily
      ? containingBucket(points, target)
      : nearestPoint(points, target);
  };

  const resolved: ResolvedPanelEvent[] = [];
  for (const event of events) {
    if (!isValidPanelEvent(event)) continue;
    const best = rowFor(event);
    if (best < 0) continue;
    const { row } = rows[best];
    resolved.push({
      index: row,
      x: String(xValues[row]),
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
