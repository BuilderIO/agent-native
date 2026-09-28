import type { CalendarEvent } from "@shared/api";

import type { CalendarEventSourceIdentity } from "@/lib/calendar-event-identity";

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
    if (
      (existing.id === event.id && sameCalendarSource(existing, event)) ||
      matchesOptimistic
    ) {
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

function normalizedEmail(value?: string) {
  return value?.trim().toLowerCase() || undefined;
}

function sameOptionalIdentity(left?: string, right?: string) {
  return (left || undefined) === (right || undefined);
}

function sameCalendarSource(
  event: CalendarEvent,
  target: CalendarEventSourceIdentity,
) {
  if (event.source !== target.source) return false;
  if (
    !sameOptionalIdentity(event.sourceId, target.sourceId) ||
    !sameOptionalIdentity(event.calendarSourceKey, target.calendarSourceKey) ||
    !sameOptionalIdentity(event.canonicalKey, target.canonicalKey) ||
    !sameOptionalIdentity(event.calendarId, target.calendarId)
  ) {
    return false;
  }

  const eventOverlayEmail = normalizedEmail(event.overlayEmail);
  const targetOverlayEmail = normalizedEmail(target.overlayEmail);
  if (eventOverlayEmail || targetOverlayEmail) {
    return Boolean(
      eventOverlayEmail && eventOverlayEmail === targetOverlayEmail,
    );
  }

  if (
    normalizedEmail(event.accountEmail) !== normalizedEmail(target.accountEmail)
  ) {
    return false;
  }
  if (event.source === "ical") {
    return Boolean(event.sourceId && target.sourceId);
  }
  return true;
}

function matchesCalendarEventId(event: CalendarEvent, eventId: string) {
  return event.id === eventId || event._replacedId === eventId;
}

export function findCalendarEventById(
  events: CalendarEvent[],
  eventId: string,
  identityOrAccount?: CalendarEventSourceIdentity | string,
) {
  const identity =
    typeof identityOrAccount === "string" ? undefined : identityOrAccount;
  const requestedEmail = normalizedEmail(
    typeof identityOrAccount === "string"
      ? identityOrAccount
      : identityOrAccount?.accountEmail,
  );
  const candidates = events.filter(
    (event) =>
      matchesCalendarEventId(event, eventId) &&
      (!requestedEmail ||
        normalizedEmail(event.accountEmail) === requestedEmail),
  );
  const sourceMatches = identity
    ? candidates.filter((event) => sameCalendarSource(event, identity))
    : candidates;
  const first = sourceMatches[0];
  if (
    !first ||
    sourceMatches.some((event) => !sameCalendarSource(event, first))
  ) {
    return undefined;
  }

  return sourceMatches.find((event) => event.id === eventId) ?? first;
}

export function findCalendarEventForSelection(
  events: CalendarEvent[],
  selectedEvent: CalendarEvent,
) {
  const candidates = events.filter(
    (event) =>
      matchesCalendarEventId(event, selectedEvent.id) &&
      sameCalendarSource(event, selectedEvent),
  );

  return (
    candidates.find((event) => event.id === selectedEvent.id) ?? candidates[0]
  );
}

export function getRemovedCalendarEvents(
  previous: CalendarEvent[] | undefined,
  next: CalendarEvent[] | undefined,
) {
  if (!previous) return [];

  const retainedCounts = new Map<CalendarEvent, number>();
  for (const event of next ?? []) {
    retainedCounts.set(event, (retainedCounts.get(event) ?? 0) + 1);
  }

  return previous.filter((event) => {
    const retainedCount = retainedCounts.get(event) ?? 0;
    if (retainedCount === 0) return true;
    retainedCounts.set(event, retainedCount - 1);
    return false;
  });
}

function hasRecurringSourceIdentity(
  event: CalendarEvent,
  target: CalendarEvent,
) {
  if (event.source !== "google") {
    return Boolean(event.sourceId && target.sourceId);
  }

  const eventOverlayEmail = normalizedEmail(event.overlayEmail);
  const targetOverlayEmail = normalizedEmail(target.overlayEmail);
  if (eventOverlayEmail || targetOverlayEmail) {
    return Boolean(
      eventOverlayEmail && eventOverlayEmail === targetOverlayEmail,
    );
  }

  const hasExplicitCalendarIdentity = Boolean(
    event.calendarSourceKey ||
    target.calendarSourceKey ||
    event.canonicalKey ||
    target.canonicalKey ||
    event.calendarId ||
    target.calendarId,
  );
  if (!hasExplicitCalendarIdentity) {
    const eventAccountEmail = normalizedEmail(event.accountEmail);
    return Boolean(
      eventAccountEmail &&
      eventAccountEmail === normalizedEmail(target.accountEmail),
    );
  }

  return Boolean(
    (event.calendarSourceKey && target.calendarSourceKey) ||
    (event.canonicalKey && target.canonicalKey) ||
    (event.calendarId && target.calendarId && event.accountEmail),
  );
}

function sameRecurringSeries(event: CalendarEvent, target: CalendarEvent) {
  return (
    sameCalendarSource(event, target) &&
    hasRecurringSourceIdentity(event, target) &&
    event.recurringEventId === (target.recurringEventId ?? target.id)
  );
}

export function calendarEventIsInScope(
  event: CalendarEvent,
  target: CalendarEvent,
  scope: RsvpScope,
) {
  if (event.id === target.id) return sameCalendarSource(event, target);
  if (scope === "single" || !sameRecurringSeries(event, target)) return false;
  if (scope === "all") return true;

  const eventStart = Date.parse(event.start);
  const targetStart = Date.parse(target.start);
  if (!Number.isFinite(eventStart) || !Number.isFinite(targetStart)) {
    return false;
  }
  return eventStart >= targetStart;
}

export function removeCalendarEventsForScope(
  old: CalendarEvent[] | undefined,
  targetId: string,
  scope: RsvpScope = "single",
  targetEvent?: CalendarEvent,
  accountEmail?: string,
) {
  if (!old) return old;
  const target =
    targetEvent ?? findCalendarEventById(old, targetId, accountEmail);
  if (!target) return old;

  return old.filter((event) => !calendarEventIsInScope(event, target, scope));
}

export function restoreMissingCalendarEvents(
  current: CalendarEvent[] | undefined,
  removed: CalendarEvent[],
) {
  if (removed.length === 0) return current;
  if (!current) return sortCalendarEvents(removed);
  const missing = removed.filter(
    (removedEvent) =>
      !current.some(
        (event) =>
          matchesCalendarEventId(event, removedEvent.id) &&
          sameCalendarSource(event, removedEvent),
      ),
  );
  return missing.length > 0
    ? sortCalendarEvents([...current, ...missing])
    : current;
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
  identity?: CalendarEventSourceIdentity,
) {
  if (!old) return old;

  const target = findCalendarEventById(old, targetId, identity ?? accountEmail);
  if (!target) return old;

  return old.map((event) =>
    calendarEventIsInScope(event, target, scope)
      ? applyRsvpStatus(event, status, accountEmail, note)
      : event,
  );
}
