import type { CalendarEvent } from "@shared/api";

const LOCATION_SUGGESTION_LIMIT = 8;

function isMeetingLink(location: string) {
  return /^(?:https?:\/\/)?(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)\b/i.test(
    location,
  );
}

/**
 * Surface only locations from the user's connected Google calendars. Overlay
 * and subscribed-calendar locations can belong to someone else.
 */
export function getLocationSuggestions(events: CalendarEvent[]): string[] {
  const seen = new Set<string>();

  return [...events]
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    .flatMap((event) => {
      const location = event.location.trim();
      const key = location.toLocaleLowerCase();
      if (
        event.source !== "google" ||
        event.overlayEmail ||
        !location ||
        isMeetingLink(location) ||
        seen.has(key)
      ) {
        return [];
      }
      seen.add(key);
      return [location];
    })
    .slice(0, LOCATION_SUGGESTION_LIMIT);
}
