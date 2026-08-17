import type { CalendarEvent } from "@shared/api";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { dateTimeInTimezoneToIso } from "./event-form-utils";

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CalendarDateTimeParts {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

export interface CalendarDayBounds {
  date: string;
  start: Date;
  end: Date;
}

export interface CalendarEventSegment {
  topMinutes: number;
  durationMinutes: number;
  startsOnDay: boolean;
  endsOnDay: boolean;
  startMinutes: number;
  endMinutes: number;
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export function normalizeTimezone(timezone?: string): string {
  return timezone && isValidTimezone(timezone)
    ? timezone
    : getBrowserTimezone();
}

/** Date carriers are kept at local noon so browser DST never changes their date. */
export function dateKeyToDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function dateToCalendarDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return next.toISOString().slice(0, 10);
}

function dateTimeParts(value: Date | string, timezone: string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(parsed);
    const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = valueFor("year");
    const month = valueFor("month");
    const day = valueFor("day");
    const hour = valueFor("hour");
    const minute = valueFor("minute");
    const second = valueFor("second");
    if (!year || !month || !day || !hour || !minute || !second) return null;

    return {
      date: `${year}-${month}-${day}`,
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    } satisfies CalendarDateTimeParts;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function getDateTimePartsInTimezone(
  value: Date | string,
  timezone: string,
): CalendarDateTimeParts | null {
  return dateTimeParts(value, normalizeTimezone(timezone));
}

export function getDateKeyInTimezone(
  value: Date | string,
  timezone: string,
): string | null {
  return dateTimeParts(value, normalizeTimezone(timezone))?.date ?? null;
}

export function dateKeyToTimezoneIso(
  date: string,
  time: string,
  timezone: string,
): string {
  return dateTimeInTimezoneToIso(date, time, normalizeTimezone(timezone));
}

export function getCalendarDayBounds(
  day: Date,
  timezone: string,
): CalendarDayBounds {
  const normalizedTimezone = normalizeTimezone(timezone);
  const date = dateToCalendarDateKey(day);
  return {
    date,
    start: new Date(dateKeyToTimezoneIso(date, "00:00", normalizedTimezone)),
    end: new Date(
      dateKeyToTimezoneIso(
        addCalendarDays(date, 1),
        "00:00",
        normalizedTimezone,
      ),
    ),
  };
}

export function getViewDateRange(
  viewMode: "month" | "week" | "day",
  selectedDate: Date,
  timezone: string,
  weekStartsOn: 0 | 1 = 0,
): { from: string; to: string } {
  const normalizedTimezone = normalizeTimezone(timezone);
  const weekOptions = { weekStartsOn };
  let rangeStart: Date;
  let rangeEndExclusive: Date;

  if (viewMode === "month") {
    rangeStart = startOfWeek(startOfMonth(selectedDate), weekOptions);
    rangeEndExclusive = addDays(
      endOfWeek(endOfMonth(selectedDate), weekOptions),
      1,
    );
  } else if (viewMode === "week") {
    rangeStart = startOfWeek(selectedDate, weekOptions);
    rangeEndExclusive = addDays(endOfWeek(selectedDate, weekOptions), 1);
  } else {
    rangeStart = selectedDate;
    rangeEndExclusive = addDays(selectedDate, 1);
  }

  return {
    from: dateKeyToTimezoneIso(
      dateToCalendarDateKey(rangeStart),
      "00:00",
      normalizedTimezone,
    ),
    to: dateKeyToTimezoneIso(
      dateToCalendarDateKey(rangeEndExclusive),
      "00:00",
      normalizedTimezone,
    ),
  };
}

function dateOnlyPart(value: string | undefined): string | null {
  if (!value) return null;
  if (DATE_ONLY_PATTERN.test(value)) return value;
  return value.slice(0, 10);
}

function eventDateRange(
  event: Pick<CalendarEvent, "start" | "end" | "allDay">,
  timezone: string,
) {
  if (event.allDay) {
    const startDate = dateOnlyPart(event.start);
    const endDate =
      dateOnlyPart(event.end) ??
      (startDate ? addCalendarDays(startDate, 1) : null);
    return startDate && endDate ? { startDate, endDate } : null;
  }

  const start = getDateTimePartsInTimezone(event.start, timezone);
  const end = getDateTimePartsInTimezone(event.end, timezone);
  return start && end ? { startDate: start.date, endDate: end.date } : null;
}

export function getEventDateKey(
  event: Pick<CalendarEvent, "start" | "end" | "allDay">,
  timezone: string,
): string | null {
  return eventDateRange(event, timezone)?.startDate ?? null;
}

export function moveEventToCalendarDate(
  event: Pick<CalendarEvent, "start" | "end" | "allDay">,
  targetDate: Date,
  timezone: string,
): { start: string; end: string } | null {
  const targetDateKey = dateToCalendarDateKey(targetDate);
  const sourceStartDate = getEventDateKey(event, timezone);
  if (!sourceStartDate) return null;

  if (event.allDay) {
    const sourceEndDate =
      dateOnlyPart(event.end) ?? addCalendarDays(sourceStartDate, 1);
    const spanDays = Math.max(
      1,
      Math.round(
        (dateKeyToDate(sourceEndDate).getTime() -
          dateKeyToDate(sourceStartDate).getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );
    return {
      start: targetDateKey,
      end: addCalendarDays(targetDateKey, spanDays),
    };
  }

  const start = getDateTimePartsInTimezone(event.start, timezone);
  const end = getDateTimePartsInTimezone(event.end, timezone);
  if (!start || !end) return null;
  const spanDays = Math.max(
    0,
    Math.round(
      (dateKeyToDate(end.date).getTime() -
        dateKeyToDate(start.date).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const startTime = `${String(start.hour).padStart(2, "0")}:${String(
    start.minute,
  ).padStart(2, "0")}`;
  const endTime = `${String(end.hour).padStart(2, "0")}:${String(
    end.minute,
  ).padStart(2, "0")}`;
  return {
    start: dateKeyToTimezoneIso(targetDateKey, startTime, timezone),
    end: dateKeyToTimezoneIso(
      addCalendarDays(targetDateKey, spanDays),
      endTime,
      timezone,
    ),
  };
}

export function eventOverlapsCalendarDay(
  event: Pick<CalendarEvent, "start" | "end" | "allDay">,
  day: Date,
  timezone: string,
): boolean {
  const normalizedTimezone = normalizeTimezone(timezone);
  const dayBounds = getCalendarDayBounds(day, normalizedTimezone);
  if (event.allDay) {
    const range = eventDateRange(event, normalizedTimezone);
    const dayDate = dayBounds.date;
    return Boolean(
      range && range.startDate <= dayDate && range.endDate > dayDate,
    );
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  return (
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start < dayBounds.end &&
    end > dayBounds.start
  );
}

function clockMinutes(parts: CalendarDateTimeParts): number {
  return parts.hour * 60 + parts.minute + parts.second / 60;
}

export function getEventSegmentForCalendarDay(
  event: Pick<CalendarEvent, "start" | "end">,
  day: Date,
  timezone: string,
): CalendarEventSegment | null {
  const normalizedTimezone = normalizeTimezone(timezone);
  const dayBounds = getCalendarDayBounds(day, normalizedTimezone);
  const rawStart = new Date(event.start);
  const rawEnd = new Date(event.end);
  if (
    Number.isNaN(rawStart.getTime()) ||
    Number.isNaN(rawEnd.getTime()) ||
    rawStart >= dayBounds.end ||
    rawEnd <= dayBounds.start
  ) {
    return null;
  }

  const start = getDateTimePartsInTimezone(rawStart, normalizedTimezone);
  const end = getDateTimePartsInTimezone(rawEnd, normalizedTimezone);
  if (!start || !end) return null;

  const startMinutes =
    start.date < dayBounds.date
      ? 0
      : start.date > dayBounds.date
        ? 24 * 60
        : clockMinutes(start);
  const endMinutes =
    end.date > dayBounds.date
      ? 24 * 60
      : end.date < dayBounds.date
        ? 0
        : clockMinutes(end);
  const visibleStart = Math.max(0, Math.min(24 * 60, startMinutes));
  const visibleEnd = Math.max(visibleStart, Math.min(24 * 60, endMinutes));

  return {
    topMinutes: visibleStart,
    durationMinutes: Math.max(1, visibleEnd - visibleStart),
    startsOnDay: start.date === dayBounds.date,
    endsOnDay: end.date === dayBounds.date,
    startMinutes: visibleStart,
    endMinutes: visibleEnd,
  };
}
