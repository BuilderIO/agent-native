import type { CalendarEvent } from "./google-calendar-client.js";

export interface CalendarAccountForEventClassification {
  email?: string | null;
  ownerEmail?: string | null;
}

const PERSONAL_SOLO_EVENT_TITLES = new Set([
  "breakfast",
  "commute",
  "dentist",
  "dentist appointment",
  "dinner",
  "doctor",
  "doctor appointment",
  "drop off kids",
  "errand",
  "errands",
  "exercise",
  "gym",
  "gym time",
  "hair appointment",
  "haircut",
  "lunch",
  "meal",
  "ooo",
  "out of office",
  "personal",
  "personal time",
  "pick up kids",
  "pilates",
  "pto",
  "run",
  "school dropoff",
  "school pickup",
  "therapy",
  "therapy appointment",
  "vacation",
  "walk",
  "workout",
  "yoga",
]);

function normalizePersonalSoloTitle(title: string | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

export function isPersonalSoloCalendarEvent(args: {
  account: CalendarAccountForEventClassification;
  event: CalendarEvent;
}): boolean {
  const normalizedTitle = normalizePersonalSoloTitle(args.event.summary);
  if (!PERSONAL_SOLO_EVENT_TITLES.has(normalizedTitle)) return false;

  const selfEmails = new Set(
    [args.account.email, args.account.ownerEmail]
      .map(normalizeEmail)
      .filter((email): email is string => Boolean(email)),
  );
  const activeAttendees = (args.event.attendees ?? []).filter(
    (attendee) => attendee.responseStatus !== "declined",
  );
  if (!activeAttendees.length) return true;

  return activeAttendees.every((attendee) => {
    const email = normalizeEmail(attendee.email);
    return Boolean(email && selfEmails.has(email));
  });
}
