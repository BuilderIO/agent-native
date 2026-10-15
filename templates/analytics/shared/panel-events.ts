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

export function isValidPanelEvent(value: unknown): value is PanelEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.date === "string" &&
    isIsoCalendarDate(event.date) &&
    typeof event.label === "string" &&
    event.label.trim() !== "" &&
    (event.color === undefined || typeof event.color === "string") &&
    (event.time === undefined ||
      (typeof event.time === "string" && TIME_OF_DAY.test(event.time))) &&
    (event.timeZone === undefined ||
      (event.time !== undefined && isValidTimeZone(event.timeZone)))
  );
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

/** The UTC instant of an event's date and time of day in its time zone. */
export function panelEventInstant(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
): number {
  const base = Date.parse(event.date);
  if (!event.time) return base;
  const [hours, minutes] = event.time.split(":").map(Number);
  const wall = base + (hours * 60 + minutes) * 60_000;
  if (!event.timeZone) return wall;
  // Second pass settles times next to a daylight-saving change.
  const first = wall - zoneOffsetMs(wall, event.timeZone);
  return wall - zoneOffsetMs(first, event.timeZone);
}

export function xInstant(value: unknown): number | null {
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

/**
 * Snaps each event to the nearest x value. Daily axes match on the event's
 * date; an axis with several points per day matches on its time of day too.
 * Rows whose x is not a date (a null bucket, a total row) are skipped; events
 * outside the x range, and x axes with no dates at all, resolve to nothing.
 */
export function resolvePanelEvents(
  events: unknown,
  xValues: readonly unknown[],
): ResolvedPanelEvent[] {
  if (!Array.isArray(events)) return [];
  const rows = xValues.flatMap((x, row) => {
    const instant = xInstant(x);
    return instant === null ? [] : [{ row, instant }];
  });
  if (rows.length === 0) return [];
  const known = rows.map((entry) => entry.instant);
  const subDaily = known.some(
    (instant, index) =>
      index > 0 && Math.abs(instant - known[index - 1]) < DAY_MS,
  );
  const points = subDaily
    ? known
    : known.map((instant) => Math.floor(instant / DAY_MS) * DAY_MS);
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

  const resolved: ResolvedPanelEvent[] = [];
  for (const event of events) {
    if (!isValidPanelEvent(event)) continue;
    const target = subDaily ? panelEventInstant(event) : Date.parse(event.date);
    if (target < min || target >= max + Math.max(step, 1)) continue;
    const best = subDaily
      ? containingBucket(points, target)
      : nearestPoint(points, target);
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

/** "3:01 AM ET" for a timed event, in its own time zone; null without a time. */
export function formatPanelEventTime(
  event: Pick<PanelEvent, "date" | "time" | "timeZone">,
  locale?: string,
): string | null {
  if (!event.time) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.timeZone ?? "UTC",
    ...(event.timeZone ? { timeZoneName: "shortGeneric" as const } : {}),
  }).format(panelEventInstant(event));
}

/** "Oct 14, 2026" for an event's date. */
export function formatPanelEventDate(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(date));
}
