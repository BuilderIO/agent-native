import type { CalendarEvent } from "@shared/api";

export type CalendarEventSourceIdentity = Pick<
  CalendarEvent,
  | "source"
  | "sourceId"
  | "accountEmail"
  | "calendarSourceKey"
  | "canonicalKey"
  | "calendarId"
  | "overlayEmail"
>;

type EventSourceIdentityInput = Partial<CalendarEventSourceIdentity>;

export function getCalendarEventSourceIdentity(
  event: EventSourceIdentityInput,
): CalendarEventSourceIdentity | undefined {
  if (!event.source) return undefined;
  if (
    !event.sourceId &&
    !event.calendarSourceKey &&
    !event.canonicalKey &&
    !event.calendarId &&
    !event.overlayEmail
  ) {
    return undefined;
  }
  return {
    source: event.source,
    sourceId: event.sourceId,
    accountEmail: event.accountEmail,
    calendarSourceKey: event.calendarSourceKey,
    canonicalKey: event.canonicalKey,
    calendarId: event.calendarId,
    overlayEmail: event.overlayEmail,
  };
}

export function withCalendarEventSourceIdentity<T extends object>(
  input: T,
  event: EventSourceIdentityInput,
): T & { cacheEventIdentity?: CalendarEventSourceIdentity } {
  const cacheEventIdentity = getCalendarEventSourceIdentity(event);
  return cacheEventIdentity ? { ...input, cacheEventIdentity } : input;
}

function normalizedEmail(value?: string) {
  return value?.trim().toLowerCase() || undefined;
}

export function getCalendarEventRenderKey(event: CalendarEvent) {
  return JSON.stringify([
    event._tempId ?? event._replacedId ?? event.id,
    event.source,
    event.sourceId || null,
    event.calendarSourceKey || null,
    event.canonicalKey || null,
    event.calendarId || null,
    normalizedEmail(event.overlayEmail) ??
      normalizedEmail(event.accountEmail) ??
      null,
  ]);
}
