import type { CalendarEvent } from "@shared/api";

type RsvpStatus = NonNullable<CalendarEvent["responseStatus"]>;
type RsvpScope = "single" | "all" | "thisAndFollowing";

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

function sameRecurringSeries(event: CalendarEvent, target: CalendarEvent) {
  if (!target.recurringEventId) return false;
  return event.recurringEventId === target.recurringEventId;
}

function shouldApplyRsvpToEvent(
  event: CalendarEvent,
  target: CalendarEvent,
  scope: RsvpScope,
) {
  if (event.id === target.id) return true;
  if (scope === "single" || !sameRecurringSeries(event, target)) return false;
  if (scope === "all") return true;

  const eventStart = Date.parse(event.start);
  const targetStart = Date.parse(target.start);
  if (!Number.isFinite(eventStart) || !Number.isFinite(targetStart)) {
    return false;
  }
  return eventStart >= targetStart;
}

function isSelfAttendee(
  attendee: NonNullable<CalendarEvent["attendees"]>[number],
  event: CalendarEvent,
  accountEmail?: string,
) {
  if (attendee.self) return true;
  const email = (accountEmail || event.accountEmail)?.trim().toLowerCase();
  return !!email && attendee.email.trim().toLowerCase() === email;
}

function applyRsvpStatus(
  event: CalendarEvent,
  status: RsvpStatus,
  accountEmail?: string,
  note?: string,
) {
  const attendees = event.attendees?.map((attendee) =>
    isSelfAttendee(attendee, event, accountEmail)
      ? {
          ...attendee,
          responseStatus: status,
          ...(note !== undefined ? { comment: note || undefined } : {}),
        }
      : attendee,
  );
  return {
    ...event,
    responseStatus: status,
    attendees,
    updatedAt: new Date().toISOString(),
  };
}

export function applyCalendarEventRsvp(
  old: CalendarEvent[] | undefined,
  targetId: string,
  status: RsvpStatus,
  scope: RsvpScope = "single",
  accountEmail?: string,
  note?: string,
) {
  if (!old) return old;

  const target = old.find((event) => event.id === targetId);
  if (!target) return old;

  return old.map((event) =>
    shouldApplyRsvpToEvent(event, target, scope)
      ? applyRsvpStatus(event, status, accountEmail, note)
      : event,
  );
}
