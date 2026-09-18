import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  getGuestAttendeeCount,
  shouldOpenGuestNotificationPrompt,
  shouldPromptGuests,
} from "./GuestNotificationDialog";

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Design review",
    description: "",
    start: "2026-05-22T16:00:00.000Z",
    end: "2026-05-22T17:00:00.000Z",
    location: "",
    allDay: false,
    source: "google",
    createdAt: "2026-05-22T15:00:00.000Z",
    updatedAt: "2026-05-22T15:00:00.000Z",
    ...overrides,
  };
}

describe("guest notification prompt helpers", () => {
  it("counts guests from pending attendee updates", () => {
    const event = calendarEvent({ attendees: [] });

    expect(
      getGuestAttendeeCount(event, [
        { email: "me@example.com", self: true },
        { email: "guest@example.com" },
      ]),
    ).toBe(1);
  });

  it("prompts when adding the first guest", () => {
    const event = calendarEvent({ attendees: [] });

    expect(
      shouldPromptGuests(event, {
        attendees: [{ email: "guest@example.com" }],
      }),
    ).toBe(true);
  });

  it("prompts for recurring update scope even without guests", () => {
    const event = calendarEvent({
      attendees: [],
      recurringEventId: "series-1",
    });

    expect(
      shouldOpenGuestNotificationPrompt({
        event,
        recurrenceScope: { enabled: true },
      }),
    ).toBe(true);
  });

  it("does not prompt for ordinary guestless updates", () => {
    const event = calendarEvent({ attendees: [] });

    expect(
      shouldOpenGuestNotificationPrompt({
        event,
        updates: { title: "New title" },
      }),
    ).toBe(false);
  });
});
