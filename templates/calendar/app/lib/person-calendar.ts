/**
 * Google calendar ids that are not a person.
 *
 * Google gives a user's own calendar their email address as its id, while
 * user-created shared calendars get `<opaque>@group.calendar.google.com` and
 * bookable rooms/equipment get `<opaque>@resource.calendar.google.com`. Those
 * two suffixes are the only reliable signal available on a calendar list entry
 * — there is no `kind` field distinguishing a person from a team calendar.
 */
const NON_PERSON_ID_SUFFIXES = [
  "@group.calendar.google.com",
  "@resource.calendar.google.com",
  "@import.calendar.google.com",
];

/**
 * Whether a shared Google calendar represents a person, and can therefore be
 * merged with an overlay peer of the same address.
 *
 * Misclassification is deliberately harmless: a team calendar wrongly grouped
 * under People is only a mislabeled row, because the reciprocity marker is
 * driven by real overlay data and is never inferred from grouping.
 */
export function isPersonCalendarId(calendarId: string): boolean {
  const id = calendarId.trim().toLowerCase();
  if (!id.includes("@")) return false;
  return !NON_PERSON_ID_SUFFIXES.some((suffix) => id.endsWith(suffix));
}
