import type { CalendarEvent } from "@shared/api";
import { addDays, parseISO, startOfDay } from "date-fns";

export interface TimedEventLayout {
  left: number;
  width: number;
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

const TEXT_REGION_MINUTES = 45;
const MIN_VISIBLE_EVENT_MINUTES = 15;

function overlaps(a: EventBounds, b: EventBounds): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Pack timed events into columns while reserving horizontal space only when
 * the event labels can collide. An event may span unused columns when another
 * event is present there at a different time, which keeps long events readable
 * without wasting the column width needed for genuinely simultaneous labels.
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

  const textOverlaps = (a: EventBounds, b: EventBounds): boolean => {
    const aTextEnd = Math.min(a.start + TEXT_REGION_MINUTES * 60 * 1000, a.end);
    const bTextEnd = Math.min(b.start + TEXT_REGION_MINUTES * 60 * 1000, b.end);
    return a.start < bTextEnd && b.start < aTextEnd;
  };

  // Place labels side by side only when their visible text regions overlap.
  const columns: EventEntry[][] = [];
  const eventColumns = new Map<CalendarEvent, number>();

  for (const entry of sorted) {
    let column = columns.findIndex((columnEntries) =>
      columnEntries.every(
        (placed) => !textOverlaps(placed.bounds, entry.bounds),
      ),
    );

    if (column === -1) {
      column = columns.length;
      columns.push([]);
    }

    columns[column].push(entry);
    eventColumns.set(entry.event, column);
  }

  const totalCols = columns.length;

  for (const [stackOrder, entry] of sorted.entries()) {
    const col = eventColumns.get(entry.event)!;
    let span = 1;

    // A column to the right is available when it has no event that overlaps
    // this card in time. Label-only collisions do not need to block expansion.
    for (let candidate = col + 1; candidate < totalCols; candidate++) {
      if (
        columns[candidate].some((other) => overlaps(other.bounds, entry.bounds))
      ) {
        break;
      }
      span++;
    }

    result.set(entry.event.id, {
      left: (col / totalCols) * 100,
      width: (span / totalCols) * 100,
      col,
      totalCols,
      stackOrder,
    });
  }

  return result;
}
