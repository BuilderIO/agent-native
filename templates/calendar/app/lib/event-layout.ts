import type { CalendarEvent } from "@shared/api";
import { addDays, parseISO, startOfDay } from "date-fns";

export interface TimedEventLayout {
  left: number;
  width: number;
  indent: number;
  col: number;
  totalCols: number;
  stackOrder: number;
}

interface EventBounds {
  start: number;
  end: number;
}

interface EventEntry {
  event: CalendarEvent;
  bounds: EventBounds;
  inputOrder: number;
}

const MIN_VISIBLE_EVENT_MINUTES = 15;
const OVERLAP_INDENT_PX = 16;

function overlaps(a: EventBounds, b: EventBounds): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Pack timed events into shallow overlap layers. Later events stay wide enough
 * to read while their inset exposes the boundary of the event underneath.
 */
export function computeTimedEventLayout(
  dayEvents: readonly CalendarEvent[],
  day: Date,
): Map<string, TimedEventLayout> {
  const result = new Map<string, TimedEventLayout>();
  if (dayEvents.length === 0) return result;

  const dayStartMs = startOfDay(day).getTime();
  const dayEndMs = addDays(startOfDay(day), 1).getTime();
  const entries = dayEvents.map<EventEntry>((event, inputOrder) => {
    const rawStart = parseISO(event.start).getTime();
    const rawEnd = parseISO(event.end).getTime();
    const start = Math.min(dayEndMs, Math.max(dayStartMs, rawStart));
    // Match the card renderer's minimum height so tiny adjacent events get
    // collision-aware placement even when their raw times barely overlap.
    const end = Math.min(
      dayEndMs,
      Math.max(start, rawEnd, start + MIN_VISIBLE_EVENT_MINUTES * 60 * 1000),
    );

    return { event, bounds: { start, end }, inputOrder };
  });

  const sorted = [...entries].sort((a, b) => {
    if (a.bounds.start !== b.bounds.start) {
      return a.bounds.start - b.bounds.start;
    }
    if (a.bounds.end !== b.bounds.end) {
      return b.bounds.end - a.bounds.end;
    }
    return a.inputOrder - b.inputOrder;
  });

  // Put overlapping events into the first layer that is free at their start.
  // Reusing finished layers keeps chained overlaps from creating empty gaps.
  const overlapLayers: EventEntry[][] = [];
  const eventColumns = new Map<CalendarEvent, number>();

  for (const entry of sorted) {
    let column = overlapLayers.findIndex((layerEntries) =>
      layerEntries.every((placed) => !overlaps(placed.bounds, entry.bounds)),
    );

    if (column === -1) {
      column = overlapLayers.length;
      overlapLayers.push([]);
    }

    overlapLayers[column].push(entry);
    eventColumns.set(entry.event, column);
  }

  const totalCols = overlapLayers.length;

  for (const [stackOrder, entry] of sorted.entries()) {
    const col = eventColumns.get(entry.event)!;

    result.set(entry.event.id, {
      left: 0,
      width: 100,
      indent: col * OVERLAP_INDENT_PX,
      col,
      totalCols,
      stackOrder,
    });
  }

  return result;
}
