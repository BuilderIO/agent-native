import type { ExternalCalendar, GoogleCalendarSource } from "./api.js";

export const MAX_CALENDAR_DESCRIPTION_LENGTH = 300;

export function normalizeCalendarDescription(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_CALENDAR_DESCRIPTION_LENGTH) : undefined;
}

export function withFeedDescription(
  feed: ExternalCalendar,
  description: string | undefined,
): ExternalCalendar {
  const next: ExternalCalendar = { ...feed };
  if (description) next.description = description;
  else delete next.description;
  return next;
}

export function owningAccountEmail(
  calendar: Pick<GoogleCalendarSource, "accountEmail" | "sourcePaths">,
): string {
  return (
    calendar.sourcePaths?.find((path) => path.primary)?.accountEmail ??
    calendar.accountEmail
  );
}
