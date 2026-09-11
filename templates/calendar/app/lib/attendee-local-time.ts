/**
 * Format and resolve per-attendee local times for an event start.
 *
 * Resolution priority for an attendee's IANA timezone:
 * 1. Self attendee (`attendee.self` or email matches accountEmail) →
 *    the browser timezone, so an event owner's timezone is never shown as
 *    the signed-in user's local time
 * 2. Optional `attendee.timeZone` on the attendee object
 * 3. User-stored override from the `attendee-timezones` setting map
 * 4. The event start timezone for the organizer when no more specific zone is
 *    available
 *
 * When no timezone is known, returns null — never invent a zone.
 */

export type AttendeeTimezoneSource = {
  email: string;
  self?: boolean;
  organizer?: boolean;
  timeZone?: string;
};

export type ResolveAttendeeTimezoneInput = {
  attendee: AttendeeTimezoneSource;
  accountEmail?: string;
  eventStartTimeZone?: string;
  /** email (lowercased) → IANA timezone overrides from user settings */
  overrides?: Record<string, string>;
  /** Browser/local fallback for the self attendee when the event has no zone */
  browserTimeZone?: string;
};

export function isSelfAttendee(
  attendee: AttendeeTimezoneSource,
  accountEmail?: string,
): boolean {
  if (attendee.self) return true;
  if (!accountEmail) return false;
  return (
    attendee.email.trim().toLowerCase() === accountEmail.trim().toLowerCase()
  );
}

export function isValidIanaTimeZone(
  timeZone: string | undefined | null,
): boolean {
  if (!timeZone?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveAttendeeTimeZone(
  input: ResolveAttendeeTimezoneInput,
): string | null {
  const {
    attendee,
    accountEmail,
    eventStartTimeZone,
    overrides,
    browserTimeZone,
  } = input;

  if (isSelfAttendee(attendee, accountEmail)) {
    const browser =
      browserTimeZone?.trim() ||
      (typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined);
    if (isValidIanaTimeZone(browser)) return browser!.trim();

    return isValidIanaTimeZone(eventStartTimeZone)
      ? eventStartTimeZone!.trim()
      : null;
  }

  if (isValidIanaTimeZone(attendee.timeZone)) {
    return attendee.timeZone!.trim();
  }

  const key = attendee.email.trim().toLowerCase();
  const override = overrides?.[key];
  if (isValidIanaTimeZone(override)) {
    return override!.trim();
  }

  if (attendee.organizer && isValidIanaTimeZone(eventStartTimeZone)) {
    return eventStartTimeZone!.trim();
  }

  return null;
}

/**
 * Formats an event start instant in a given IANA timezone as a short local
 * time label, e.g. "6:30 AM EDT".
 */
export function formatAttendeeLocalTime(
  startIso: string,
  timeZone: string,
  locale = "en-US",
): string | null {
  if (!isValidIanaTimeZone(timeZone)) return null;
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timeZone.trim(),
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return null;
  }
}

export function getAttendeeLocalTimeLabel(
  input: ResolveAttendeeTimezoneInput & {
    startIso: string;
    locale?: string;
  },
): string | null {
  const timeZone = resolveAttendeeTimeZone(input);
  if (!timeZone) return null;
  return formatAttendeeLocalTime(input.startIso, timeZone, input.locale);
}
