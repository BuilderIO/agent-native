import type { CalendarEventDraft } from "@shared/api";

import { addCalendarDays, dateToCalendarDateKey } from "./calendar-timezone";

export function resolveDraftWorkingLocation(
  draft: Pick<
    CalendarEventDraft,
    "workingLocationType" | "workingLocationLabel" | "location"
  >,
): {
  workingLocationType: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel: string;
} {
  return {
    workingLocationType: draft.workingLocationType ?? "homeOffice",
    // Drafts initialize `location` to "", so `??` would drop the Other name.
    workingLocationLabel: (
      draft.workingLocationLabel ||
      draft.location ||
      ""
    ).trim(),
  };
}

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
