import type { CalendarEvent } from "@shared/api";
import { addDays, parseISO, startOfDay } from "date-fns";

import { isWorkingLocationEvent } from "@/lib/working-location";

export interface AllDaySpan {
  event: CalendarEvent;
  startCol: number;
  endCol: number;
}

export interface AllDayPlacement extends AllDaySpan {
  row: number;
}

export interface AllDayLayout {
  placements: AllDayPlacement[];
  rowCount: number;
}

export type AllDayPlacementGroup = AllDayPlacement[];

export function partitionAllDayEvents(events: CalendarEvent[]) {
  const workingLocations: CalendarEvent[] = [];
  const regularEvents: CalendarEvent[] = [];

  for (const event of events) {
    if (isWorkingLocationEvent(event)) workingLocations.push(event);
    else regularEvents.push(event);
  }

  return { workingLocations, regularEvents };
}

/** Determine which visible day columns an all-day event overlaps. */
export function getAllDaySpan(
  event: CalendarEvent,
  days: Date[],
): Omit<AllDaySpan, "event"> | null {
  const eventStart = parseISO(event.start);
  const eventEnd = event.end ? parseISO(event.end) : addDays(eventStart, 1);

  let startCol = -1;
  let endCol = -1;

  for (let index = 0; index < days.length; index++) {
    const dayStart = startOfDay(days[index]);
    const dayEnd = addDays(dayStart, 1);
    if (eventStart < dayEnd && eventEnd > dayStart) {
      if (startCol === -1) startCol = index;
      endCol = index;
    }
  }

  return startCol === -1 ? null : { startCol, endCol };
}

function compareSpans(a: AllDaySpan, b: AllDaySpan): number {
  if (a.startCol !== b.startCol) return a.startCol - b.startCol;
  if (a.endCol !== b.endCol) return b.endCol - a.endCol;
  return a.event.id.localeCompare(b.event.id);
}

export function layoutAllDayEvents(
  events: CalendarEvent[],
  days: Date[],
): AllDayLayout {
  const spans = events
    .map((event) => {
      const span = getAllDaySpan(event, days);
      return span ? { event, ...span } : null;
    })
    .filter((span): span is AllDaySpan => span !== null)
    .sort(compareSpans);
  const rows: AllDaySpan[][] = [];
  const placements: AllDayPlacement[] = [];

  for (const span of spans) {
    let row = rows.findIndex((candidate) =>
      candidate.every(
        (existing) =>
          span.endCol < existing.startCol || span.startCol > existing.endCol,
      ),
    );

    if (row === -1) {
      row = rows.length;
      rows.push([]);
    }

    rows[row].push(span);
    placements.push({ ...span, row });
  }

  return { placements, rowCount: rows.length };
}

/** Group visually adjacent placements while preserving each event's click target. */
export function groupAdjacentAllDayPlacements(
  placements: AllDayPlacement[],
  getGroupKey: (placement: AllDayPlacement) => string,
): AllDayPlacementGroup[] {
  const sorted = [...placements].sort(
    (a, b) => a.row - b.row || a.startCol - b.startCol,
  );
  const groups: AllDayPlacementGroup[] = [];

  for (const placement of sorted) {
    const previousGroup = groups[groups.length - 1];
    const previousPlacement = previousGroup?.[previousGroup.length - 1];
    const isAdjacent =
      previousPlacement?.row === placement.row &&
      previousPlacement.endCol + 1 === placement.startCol;
    const isSameGroup =
      previousPlacement !== undefined &&
      getGroupKey(previousPlacement) === getGroupKey(placement);

    if (previousGroup && isAdjacent && isSameGroup) {
      previousGroup.push(placement);
    } else {
      groups.push([placement]);
    }
  }

  return groups;
}
