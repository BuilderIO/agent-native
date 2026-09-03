import type { CalendarEvent } from "../shared/api.js";

const SEARCH_STOPWORDS = new Set([
  "a",
  "about",
  "all",
  "and",
  "at",
  "call",
  "calls",
  "calendar",
  "event",
  "events",
  "for",
  "from",
  "history",
  "meeting",
  "meetings",
  "my",
  "of",
  "on",
  "related",
  "the",
  "to",
  "with",
]);

export function calendarEventSearchText(event: CalendarEvent): string {
  return [
    event.title,
    event.description,
    event.location,
    event.organizer?.email,
    event.organizer?.displayName,
    ...(event.attendees ?? []).flatMap((attendee) => [
      attendee.email,
      attendee.displayName,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function calendarSearchTokens(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9@._]+/g, " ");

  return Array.from(
    new Set(
      (
        normalized.match(
          /[a-z0-9._%+]+@[a-z0-9.-]+|[a-z0-9]+(?:\.[a-z0-9]+)*/g,
        ) ?? []
      )
        .map((token) => token.trim())
        .filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token)),
    ),
  );
}

export function calendarEventMatchesQuery(
  event: CalendarEvent,
  query: string,
): boolean {
  const haystack = calendarEventSearchText(event);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  if (haystack.includes(normalizedQuery)) return true;

  const tokens = calendarSearchTokens(query);
  if (tokens.length === 0) return false;
  return tokens.every((token) => haystack.includes(token));
}
