import type { CalendarEvent } from "../../shared/api.js";

type AvailabilityEvent = Pick<
  CalendarEvent,
  | "accountEmail"
  | "attendees"
  | "end"
  | "eventType"
  | "responseStatus"
  | "start"
  | "status"
  | "transparency"
>;

function sameEmail(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function findSelfAttendee(event: AvailabilityEvent) {
  return event.attendees?.find(
    (attendee) =>
      attendee.self === true || sameEmail(attendee.email, event.accountEmail),
  );
}

export function eventBlocksAvailability(event: AvailabilityEvent): boolean {
  if (!event.start || !event.end) return false;
  if (event.status === "cancelled") return false;
  if (event.eventType === "workingLocation") return false;
  if (event.transparency === "transparent") return false;

  const selfAttendee = findSelfAttendee(event);
  const selfStatus = event.responseStatus ?? selfAttendee?.responseStatus;
  if (selfStatus === "declined") return false;

  return true;
}
