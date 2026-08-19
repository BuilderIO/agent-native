/**
 * The one check for "is this a usable IANA zone", shared by client, server, and
 * actions. Only a `RangeError` means Intl rejected the zone; any other failure
 * is a real fault and must surface instead of being reported as "invalid".
 */
export function isCalendarTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
