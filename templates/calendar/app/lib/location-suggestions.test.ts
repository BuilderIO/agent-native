import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import { getLocationSuggestions } from "./location-suggestions";

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    title: "Meeting",
    description: "",
    start: "2026-07-29T09:00:00.000Z",
    end: "2026-07-29T10:00:00.000Z",
    location: "",
    allDay: false,
    source: "google",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    ...overrides,
  };
}

describe("getLocationSuggestions", () => {
  it("returns recent unique locations from the user's Google calendars", () => {
    expect(
      getLocationSuggestions([
        event({
          id: "old",
          location: "1 Market St, San Francisco, CA",
          start: "2026-07-28T09:00:00.000Z",
        }),
        event({
          id: "recent",
          location: "Pier 57, New York, NY",
          start: "2026-07-29T09:00:00.000Z",
        }),
        event({
          id: "duplicate",
          location: "  1 MARKET ST, SAN FRANCISCO, CA  ",
          start: "2026-07-30T09:00:00.000Z",
        }),
      ]),
    ).toEqual(["1 MARKET ST, SAN FRANCISCO, CA", "Pier 57, New York, NY"]);
  });

  it("does not expose overlay, subscribed-calendar, or meeting-link locations", () => {
    expect(
      getLocationSuggestions([
        event({
          id: "overlay",
          location: "Private address",
          overlayEmail: "alice@example.com",
        }),
        event({ id: "feed", location: "Subscriber address", source: "ical" }),
        event({ id: "meet", location: "https://meet.google.com/abc-defg-hij" }),
        event({ id: "owned", location: "500 Howard St, San Francisco, CA" }),
      ]),
    ).toEqual(["500 Howard St, San Francisco, CA"]);
  });
});
