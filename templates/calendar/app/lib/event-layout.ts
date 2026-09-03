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
    const sameStartGroups = new Map<number, EventEntry[]>();
    const sameStartIndexes = new Map<EventEntry, number>();
    for (const entry of group) {
      const entries = sameStartGroups.get(entry.bounds.start) ?? [];
      sameStartIndexes.set(entry, entries.length);
      entries.push(entry);
      sameStartGroups.set(entry.bounds.start, entries);
    }

    for (const entry of group) {
      const col = eventColumns.get(entry.event)!;
      const sameStartEntries = sameStartGroups.get(entry.bounds.start)!;
      const sameStartIndex = sameStartIndexes.get(entry)!;
      const sameStartWidth = 100 / sameStartEntries.length;
      const isGroupStart = entry.bounds.start === group[0].bounds.start;
      const useStartLanes = sameStartEntries.length > 1;

      // Later events sit over the earlier event instead of forcing both cards
      // into equal columns. Events with the same start time still get lanes so
      // their titles remain independently readable.
      const left = useStartLanes ? sameStartIndex * sameStartWidth : 0;
      const width = 100 - left;

      result.set(entry.event.id, {
        left,
        width,
        indent: isGroupStart && sameStartIndex === 0 ? 0 : OVERLAP_INDENT_PX,
        col,
        totalCols,
        stackOrder: stackOrder++,
      });
    }
  }

  return result;
}
