import type { CalendarEvent } from "@shared/api";
import { addDays, differenceInMinutes, parseISO, startOfDay } from "date-fns";

export interface OutOfOfficeSegment {
  topMinutes: number;
  durationMinutes: number;
  startsOnDay: boolean;
  endsOnDay: boolean;
}

export function isOutOfOfficeEvent(
  event: Pick<CalendarEvent, "eventType">,
): boolean {
  return event.eventType === "outOfOffice";
}

/** Return the portion of a timed out-of-office event visible on one day. */
export function getOutOfOfficeSegment(
  event: Pick<CalendarEvent, "start" | "end">,
  day: Date,
): OutOfOfficeSegment | null {
  const eventStart = parseISO(event.start);
  const eventEnd = parseISO(event.end);
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  if (eventStart >= dayEnd || eventEnd <= dayStart) return null;

  const segmentStart = eventStart > dayStart ? eventStart : dayStart;
  const segmentEnd = eventEnd < dayEnd ? eventEnd : dayEnd;

  return {
    topMinutes: Math.max(0, differenceInMinutes(segmentStart, dayStart)),
    durationMinutes: Math.max(1, differenceInMinutes(segmentEnd, segmentStart)),
    startsOnDay: eventStart >= dayStart && eventStart < dayEnd,
    endsOnDay: eventEnd > dayStart && eventEnd <= dayEnd,
  };
}

export function getFirstVisibleOutOfOfficeDayIndex(
  event: Pick<CalendarEvent, "start" | "end">,
  days: Date[],
): number {
  return days.findIndex((day) => getOutOfOfficeSegment(event, day) !== null);
}
