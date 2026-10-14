import type { PanelEvent } from "../app/pages/adhoc/sql-dashboard/types";

export interface ResolvedPanelEvent {
  index: number;
  x: string;
  date: string;
  label: string;
  color?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidPanelEvent(value: unknown): value is PanelEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.date === "string" &&
    ISO_DATE.test(event.date) &&
    !Number.isNaN(Date.parse(event.date)) &&
    typeof event.label === "string" &&
    event.label.trim() !== "" &&
    (event.color === undefined || typeof event.color === "string")
  );
}

function dayOf(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  const ms = Date.parse(
    ISO_DATE.test(text.slice(0, 10)) ? text.slice(0, 10) : text,
  );
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Snaps each event to the nearest x value. Events outside the x range, and
 * x axes that are not dates, resolve to nothing.
 */
export function resolvePanelEvents(
  events: unknown,
  xValues: readonly unknown[],
): ResolvedPanelEvent[] {
  if (!Array.isArray(events) || xValues.length === 0) return [];
  const days = xValues.map(dayOf);
  const known = days.filter((d): d is number => d !== null);
  if (known.length === 0 || known.length !== days.length) return [];
  const min = Math.min(...known);
  const max = Math.max(...known);

  const resolved: ResolvedPanelEvent[] = [];
  for (const event of events) {
    if (!isValidPanelEvent(event)) continue;
    const target = Date.parse(event.date);
    if (target < min || target > max) continue;
    let best = 0;
    for (let i = 1; i < days.length; i++) {
      if (
        Math.abs((days[i] as number) - target) <
        Math.abs((days[best] as number) - target)
      ) {
        best = i;
      }
    }
    resolved.push({
      index: best,
      x: String(xValues[best]),
      date: event.date,
      label: event.label,
      ...(event.color ? { color: event.color } : {}),
    });
  }
  return resolved;
}
