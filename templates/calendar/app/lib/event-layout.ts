import type { CalendarEvent } from "@shared/api";

import {
  getBrowserTimezone,
  getEventSegmentForCalendarDay,
} from "@/lib/calendar-timezone";

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
  timezone: string = getBrowserTimezone(),
): Map<string, TimedEventLayout> {
  const result = new Map<string, TimedEventLayout>();
  if (dayEvents.length === 0) return result;

  const entries = dayEvents.map<EventEntry>((event, inputOrder) => {
    const segment = getEventSegmentForCalendarDay(event, day, timezone);
    const start = segment?.startMinutes ?? 0;
    // Match the card renderer's minimum height so tiny adjacent events get
    // collision-aware placement even when their raw times barely overlap.
    const end = Math.min(
      24 * 60,
      Math.max(
        start,
        segment?.endMinutes ?? start,
        start + MIN_VISIBLE_EVENT_MINUTES,
      ),
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

  // Split the sorted events into connected overlap groups: a run of events
  // where each overlaps the running span of the group before it. Interval
  // graphs make this sweep exact — two events end up in the same component
  // iff a chain of pairwise overlaps connects them — so an isolated event
  // later in the day never inherits column math from an unrelated overlap
  // earlier in the day.
  const groups: EventEntry[][] = [];
  let groupMaxEnd = -Infinity;

  for (const entry of sorted) {
    if (groups.length === 0 || entry.bounds.start >= groupMaxEnd) {
      groups.push([]);
      groupMaxEnd = -Infinity;
    }
    groups[groups.length - 1].push(entry);
    groupMaxEnd = Math.max(groupMaxEnd, entry.bounds.end);
  }

  let stackOrder = 0;
  for (const group of groups) {
    // Put overlapping events into the first layer that is free at their
    // start. Reusing finished layers keeps chained overlaps from creating
    // empty gaps.
    const overlapLayers: EventEntry[][] = [];
    const eventColumns = new Map<CalendarEvent, number>();

    for (const entry of group) {
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
    // Give every overlap column a proportional slice of the day column so an
    // event's right edge stays visible instead of being covered by whichever
    // card renders on top of it.
    const width = 100 / totalCols;

    for (const entry of group) {
      const col = eventColumns.get(entry.event)!;

      result.set(entry.event.id, {
        left: col * width,
        width,
        indent: col * OVERLAP_INDENT_PX,
        col,
        totalCols,
        stackOrder: stackOrder++,
      });
    }
  }

  return result;
}
