import type { CalendarEvent } from "@shared/api";

export function calendarEventOverlapsListParams(
  event: Pick<CalendarEvent, "start" | "end">,
  params?: Record<string, string>,
) {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  const from = params?.from
    ? Date.parse(params.from)
    : Number.NEGATIVE_INFINITY;
  const to = params?.to ? Date.parse(params.to) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;

  return end > from && start < to;
}

function sortCalendarEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function mergeCalendarEventIntoList(
  old: CalendarEvent[] | undefined,
  event: CalendarEvent,
  optimisticId?: string,
): CalendarEvent[] {
  const nextEvent =
    optimisticId && event.id !== optimisticId
      ? { ...event, _tempId: event._tempId ?? optimisticId }
      : event;

  if (!old) return [nextEvent];

  let replaced = false;
  const next = old.map((existing) => {
    const matchesOptimistic =
      optimisticId &&
      (existing.id === optimisticId || existing._tempId === optimisticId);
    if (existing.id === event.id || matchesOptimistic) {
      replaced = true;
      return nextEvent;
    }
    return existing;
  });

  if (!replaced) next.push(nextEvent);
  return sortCalendarEvents(next);
}

export function removeOptimisticCalendarEventFromList(
  old: CalendarEvent[] | undefined,
  optimisticId: string,
) {
  return old?.filter(
    (event) => event.id !== optimisticId && event._tempId !== optimisticId,
  );
}
