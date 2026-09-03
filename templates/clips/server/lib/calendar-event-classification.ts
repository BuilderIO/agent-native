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

export function isDeclinedCalendarEvent(args: {
  account: CalendarAccountForEventClassification;
  event: CalendarEvent;
  currentUserEmail?: string | null;
}): boolean {
  const selfEmails = new Set(
    [args.currentUserEmail, args.account.email, args.account.ownerEmail]
      .map(normalizeEmail)
      .filter((email): email is string => Boolean(email)),
  );

  return (args.event.attendees ?? []).some((attendee) => {
    if (attendee.responseStatus !== "declined") return false;
    if (attendee.self === true) return true;
    const email = normalizeEmail(attendee.email);
    return Boolean(email && selfEmails.has(email));
  });
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

/**
 * True when a calendar event has no active attendee besides the current user.
 * This is intentionally broader than the title-based personal-event helper:
 * desktop meeting reminders should not surface for any self-only event.
 */
export function isSoloCalendarEvent(args: {
  account: CalendarAccountForEventClassification;
  event: CalendarEvent;
  currentUserEmail?: string | null;
}): boolean {
  const selfEmails = new Set(
    [args.currentUserEmail, args.account.email, args.account.ownerEmail]
      .map(normalizeEmail)
      .filter((email): email is string => Boolean(email)),
  );

  const organizerEmail = normalizeEmail(args.event.organizer?.email);
  if (organizerEmail && !selfEmails.has(organizerEmail)) return false;

  const activeAttendees = (args.event.attendees ?? []).filter(
    (attendee) => attendee.responseStatus !== "declined",
  );
  return activeAttendees.every((attendee) => {
    const email = normalizeEmail(attendee.email);
    return Boolean(email && selfEmails.has(email));
  });
}
