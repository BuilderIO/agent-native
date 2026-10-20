import type { CalendarEvent } from "./api.js";

export function isCalendarEventOrganizer(event: CalendarEvent): boolean {
  if (event.organizer?.self === false) return false;
  if (event.organizer?.self) return true;
  if (
    event.attendees?.some((attendee) => attendee.self && attendee.organizer)
  ) {
    return true;
  }
  return !event.attendees || event.attendees.length === 0;
}
