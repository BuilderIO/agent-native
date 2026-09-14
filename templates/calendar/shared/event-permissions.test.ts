import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "./api";
import { isCalendarEventOrganizer } from "./event-permissions";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Planning",
    description: "",
    start: "2026-05-21T19:30:00.000Z",
    end: "2026-05-21T20:00:00.000Z",
    location: "",
    allDay: false,
    source: "google",
    organizer: { email: "owner@example.com" },
    createdAt: "2026-05-21T18:00:00.000Z",
    updatedAt: "2026-05-21T18:00:00.000Z",
    ...overrides,
  };
}

describe("isCalendarEventOrganizer", () => {
  it("does not treat an explicit non-organizer as an organizer when attendees are omitted", () => {
    expect(
      isCalendarEventOrganizer(
        event({ organizer: { email: "guest@example.com", self: false } }),
      ),
    ).toBe(false);
  });

  it("keeps the no-attendee fallback for events without an explicit organizer answer", () => {
    expect(isCalendarEventOrganizer(event({ organizer: undefined }))).toBe(
      true,
    );
  });
});
