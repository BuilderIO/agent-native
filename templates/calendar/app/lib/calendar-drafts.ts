import type { CalendarEventDraft } from "@shared/api";

import { addCalendarDays, dateToCalendarDateKey } from "./calendar-timezone";

export function buildWorkingLocationDraft({
  id,
  date,
  accountEmail,
  now = new Date().toISOString(),
}: {
  id: string;
  date: Date;
  accountEmail?: string;
  now?: string;
}): CalendarEventDraft {
  const dateKey = dateToCalendarDateKey(date);
  return {
    id,
    title: "",
    description: "",
    location: "",
    start: dateKey,
    end: addCalendarDays(dateKey, 1),
    startTimeZone: undefined,
    endTimeZone: undefined,
    allDay: true,
    eventType: "workingLocation",
    workingLocationType: "homeOffice",
    workingLocationLabel: "",
    transparency: "transparent",
    visibility: "public",
    accountEmail,
    createdAt: now,
    updatedAt: now,
  };
}
