import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../shared/api";
import { eventBlocksAvailability } from "./calendar-availability";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Test event",
    description: "",
    start: "2026-05-07T15:00:00.000Z",
    end: "2026-05-07T15:30:00.000Z",
    location: "",
    allDay: false,
    source: "google",
    accountEmail: "host@example.com",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("eventBlocksAvailability", () => {
  it("does not block time for Google events marked free", () => {
    expect(
      eventBlocksAvailability(event({ transparency: "transparent" })),
    ).toBe(false);
  });

  it("does not block time when the host declined the event", () => {
    expect(eventBlocksAvailability(event({ responseStatus: "declined" }))).toBe(
      false,
    );
  });

  it("does not block time when the matching attendee declined", () => {
    expect(
      eventBlocksAvailability(
        event({
          attendees: [
            { email: "host@example.com", responseStatus: "declined" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("does not block time for attendee events where the host is not attending", () => {
    expect(
      eventBlocksAvailability(
        event({
          attendees: [
            { email: "someone@example.com", responseStatus: "accepted" },
          ],
          organizer: { email: "organizer@example.com" },
        }),
      ),
    ).toBe(false);
  });

  it("blocks time for accepted self attendee events", () => {
    expect(
      eventBlocksAvailability(
        event({
          attendees: [
            {
              email: "host@example.com",
              responseStatus: "accepted",
              self: true,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("blocks time for events organized by the host even without a self attendee", () => {
    expect(
      eventBlocksAvailability(
        event({
          attendees: [
            { email: "guest@example.com", responseStatus: "accepted" },
          ],
          organizer: { email: "host@example.com" },
        }),
      ),
    ).toBe(true);
  });
});
