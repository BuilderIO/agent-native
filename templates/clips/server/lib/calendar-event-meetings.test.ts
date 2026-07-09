import { describe, expect, it } from "vitest";

import {
  type CalendarAccountForEventClassification,
  isPersonalSoloCalendarEvent,
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
