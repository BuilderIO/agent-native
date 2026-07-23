import { describe, expect, it } from "vitest";

import {
  isDeclinedCalendarEvent,
  type CalendarAccountForEventClassification,
  isPersonalSoloCalendarEvent,
  isSoloCalendarEvent,
} from "./calendar-event-classification";
import type { CalendarEvent } from "./google-calendar-client";

const account: CalendarAccountForEventClassification = {
  email: "user@example.com",
  ownerEmail: "user@example.com",
};

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event_1",
    summary: "Standup",
    start: { dateTime: "2026-07-09T16:00:00.000Z" },
    end: { dateTime: "2026-07-09T16:30:00.000Z" },
    ...overrides,
  };
}

describe("calendar personal solo event detection", () => {
  it("flags obvious personal blocks with no attendees", () => {
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Gym", attendees: [] }),
      }),
    ).toBe(true);
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Dinner", attendees: undefined }),
      }),
    ).toBe(true);
  });

  it("flags personal blocks that only include the calendar owner", () => {
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({
          summary: "Lunch",
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("keeps events with active attendees or less obvious titles", () => {
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({
          summary: "Dinner",
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
            { email: "teammate@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(false);
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Dinner with Bob", attendees: [] }),
      }),
    ).toBe(false);
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Product review", attendees: [] }),
      }),
    ).toBe(false);
  });
});

describe("calendar solo event detection", () => {
  it("flags any event with no attendees besides the calendar owner", () => {
    expect(
      isSoloCalendarEvent({
        account,
        event: event({ summary: "Steve im Seattle", attendees: [] }),
      }),
    ).toBe(true);
    expect(
      isSoloCalendarEvent({
        account,
        event: event({
          summary: "Steve im Seattle",
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("keeps events with an active attendee or external organizer", () => {
    expect(
      isSoloCalendarEvent({
        account,
        event: event({
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
            { email: "teammate@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(false);
    expect(
      isSoloCalendarEvent({
        account,
        event: event({
          attendees: [],
          organizer: { email: "teammate@example.com" },
        }),
      }),
    ).toBe(false);
  });
});

describe("calendar declined event detection", () => {
  it("flags an event declined by the current user even when others accepted", () => {
    expect(
      isDeclinedCalendarEvent({
        account,
        event: event({
          attendees: [
            { email: "user@example.com", responseStatus: "declined" },
            { email: "teammate@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("does not flag an event declined by another attendee", () => {
    expect(
      isDeclinedCalendarEvent({
        account,
        event: event({
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
            { email: "teammate@example.com", responseStatus: "declined" },
          ],
        }),
      }),
    ).toBe(false);
  });

  it("trusts Google's self marker when the attendee email is omitted", () => {
    expect(
      isDeclinedCalendarEvent({
        account,
        event: event({
          attendees: [{ responseStatus: "declined", self: true }],
        }),
      }),
    ).toBe(true);
  });
});
