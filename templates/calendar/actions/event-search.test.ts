import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "../shared/api.js";
import {
  calendarEventMatchesQuery,
  calendarSearchTokens,
} from "./event-search";

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    title: "David Popowitz and Steve Sewell",
    description: "",
    start: "2025-03-11T23:00:00Z",
    end: "2025-03-11T23:30:00Z",
    location: "",
    allDay: false,
    source: "google",
    attendees: [{ email: "poppy@adobe.com", displayName: "David Popowitz" }],
    createdAt: "2025-03-01T00:00:00Z",
    updatedAt: "2025-03-01T00:00:00Z",
    ...overrides,
  };
}

describe("calendar event search", () => {
  it("drops meeting filler words so company-history queries match attendee domains", () => {
    expect(calendarSearchTokens("my Adobe-related meetings")).toEqual([
      "adobe",
    ]);

    expect(calendarEventMatchesQuery(event({}), "my Adobe meetings")).toBe(
      true,
    );
  });

  it("matches multi-token people queries across title and attendee metadata", () => {
    expect(calendarEventMatchesQuery(event({}), "David Popowitz")).toBe(true);
  });

  it("does not match unrelated company queries", () => {
    expect(calendarEventMatchesQuery(event({}), "Figma meetings")).toBe(false);
  });
});
