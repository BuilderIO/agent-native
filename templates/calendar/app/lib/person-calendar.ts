const GOOGLE_CALENDAR_DOMAIN = "calendar.google.com";

export function isPersonCalendarId(calendarId: string): boolean {
  const id = calendarId.trim().toLowerCase();
  const at = id.lastIndexOf("@");
  if (at === -1) return false;
  const domain = id.slice(at + 1);
  return (
    domain !== GOOGLE_CALENDAR_DOMAIN &&
    !domain.endsWith(`.${GOOGLE_CALENDAR_DOMAIN}`)
  );
}
