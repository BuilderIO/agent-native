import type { CalendarEvent } from "@shared/api";
import {
  addDays,
  differenceInMinutes,
  format,
  parseISO,
  startOfDay,
} from "date-fns";

import { dateTimeInTimezoneToIso } from "@/lib/event-form-utils";

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

function localDateTimeParts(value: string, timeZone: string) {
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = valueFor("year");
    const month = valueFor("month");
    const day = valueFor("day");
    const hour = valueFor("hour");
    const minute = valueFor("minute");
    if (!year || !month || !day || !hour || !minute) return null;
    return { date: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
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
  const start = localDateTimeParts(event.start, timeZone);
  const end = localDateTimeParts(event.end, timeZone);
  const isFullDay =
    start !== null &&
    end !== null &&
    new Date(event.start).getTime() ===
      new Date(
        dateTimeInTimezoneToIso(start.date, "00:00", timeZone),
      ).getTime() &&
    new Date(event.end).getTime() ===
      new Date(
        dateTimeInTimezoneToIso(end.date, "00:00", timeZone),
      ).getTime() &&
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
  const dateString = format(date, "yyyy-MM-dd");
  return dateString >= range.startDate && dateString < range.endDateExclusive;
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
