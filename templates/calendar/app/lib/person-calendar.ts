const NON_PERSON_ID_SUFFIXES = [
  "@group.calendar.google.com",
  "@resource.calendar.google.com",
  "@import.calendar.google.com",
];

export function isPersonCalendarId(calendarId: string): boolean {
  const id = calendarId.trim().toLowerCase();
  if (!id.includes("@")) return false;
  return !NON_PERSON_ID_SUFFIXES.some((suffix) => id.endsWith(suffix));
}
