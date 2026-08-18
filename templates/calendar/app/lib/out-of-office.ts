import type { CalendarEvent } from "@shared/api";

import {
  dateKeyToTimezoneIso,
  dateToCalendarDateKey,
  getBrowserTimezone,
  getDateTimePartsInTimezone,
  getEventSegmentForCalendarDay,
} from "@/lib/calendar-timezone";

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

export function isFullDayOutOfOfficeEvent(
  event: Pick<
    CalendarEvent,
    "eventType" | "allDay" | "start" | "end" | "startTimeZone" | "endTimeZone"
  >,
): boolean {
  return getFullDayOutOfOfficeDateRange(event) !== null;
}

export function getFullDayOutOfOfficeDateRange(
  event: Pick<
    CalendarEvent,
    "eventType" | "allDay" | "start" | "end" | "startTimeZone" | "endTimeZone"
  >,
): { startDate: string; endDateExclusive: string } | null {
  if (!isOutOfOfficeEvent(event) || event.allDay) return null;
  const timeZone = event.startTimeZone ?? event.endTimeZone;
  if (!timeZone) return null;
  const start = getDateTimePartsInTimezone(event.start, timeZone);
  const end = getDateTimePartsInTimezone(event.end, timeZone);
  const isFullDay =
    start !== null &&
    end !== null &&
    new Date(event.start).getTime() ===
      new Date(dateKeyToTimezoneIso(start.date, "00:00", timeZone)).getTime() &&
    new Date(event.end).getTime() ===
      new Date(dateKeyToTimezoneIso(end.date, "00:00", timeZone)).getTime() &&
    end.date > start.date;
  return isFullDay
    ? { startDate: start.date, endDateExclusive: end.date }
    : null;
}

export function fullDayOutOfOfficeCoversDate(
  event: Pick<
    CalendarEvent,
    "eventType" | "allDay" | "start" | "end" | "startTimeZone" | "endTimeZone"
  >,
  date: Date,
): boolean {
  const range = getFullDayOutOfOfficeDateRange(event);
  if (!range) return false;
  const dateString = dateToCalendarDateKey(date);
  return dateString >= range.startDate && dateString < range.endDateExclusive;
}

/** Return the portion of a timed out-of-office event visible on one day. */
export function getOutOfOfficeSegment(
  event: Pick<CalendarEvent, "start" | "end" | "startTimeZone" | "endTimeZone">,
  day: Date,
  timezone: string = event.startTimeZone ??
    event.endTimeZone ??
    getBrowserTimezone(),
): OutOfOfficeSegment | null {
  const segment = getEventSegmentForCalendarDay(event, day, timezone);
  if (!segment) return null;

  return {
    topMinutes: segment.topMinutes,
    durationMinutes: segment.durationMinutes,
    startsOnDay: segment.startsOnDay,
    endsOnDay: segment.endsOnDay,
  };
}

export function getFirstVisibleOutOfOfficeDayIndex(
  event: Pick<CalendarEvent, "start" | "end" | "startTimeZone" | "endTimeZone">,
  days: Date[],
  timezone: string = event.startTimeZone ??
    event.endTimeZone ??
    getBrowserTimezone(),
): number {
  return days.findIndex(
    (day) => getOutOfOfficeSegment(event, day, timezone) !== null,
  );
}
