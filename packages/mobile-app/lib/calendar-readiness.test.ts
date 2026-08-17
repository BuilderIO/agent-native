import { describe, expect, it } from "vitest";

import {
  deriveMeetingJoinUrl,
  findNextUpcomingMeeting,
  formatUpcomingMeetingTiming,
  isReadableCalendar,
} from "./calendar-readiness";

describe("isReadableCalendar", () => {
  it("keeps accessible calendars and skips hidden, unsynced, or blocked ones", () => {
    expect(isReadableCalendar({})).toBe(true);
    expect(isReadableCalendar({ accessLevel: "read" })).toBe(true);
    expect(isReadableCalendar({ accessLevel: "none" })).toBe(false);
    expect(isReadableCalendar({ isVisible: false })).toBe(false);
    expect(isReadableCalendar({ isSynced: false })).toBe(false);
  });
});

describe("deriveMeetingJoinUrl", () => {
  it("prefers the explicit event URL and normalizes http links", () => {
    expect(
      deriveMeetingJoinUrl({
        url: "https://meet.example.com/room",
        location: "https://fallback.example.com/room",
        notes: null,
      }),
    ).toBe("https://meet.example.com/room");
  });

  it("extracts a safe link from location or notes", () => {
    expect(
      deriveMeetingJoinUrl({
        url: "zoommtg://private-room",
        location: "Conference room 4",
        notes: "Join at https://video.example.com/standup). See you there.",
      }),
    ).toBe("https://video.example.com/standup");
  });

  it("rejects non-http schemes and credential-bearing links", () => {
    expect(
      deriveMeetingJoinUrl({
        url: "javascript:alert(1)",
        location: "ftp://example.com/room",
        notes: "https://user:secret@example.com/room",
      }),
    ).toBeUndefined();
  });
});

describe("findNextUpcomingMeeting", () => {
  const now = new Date("2026-01-15T17:00:00.000Z");

  it("returns the next ongoing or future non-cancelled event", () => {
    const next = findNextUpcomingMeeting(
      [
        {
          id: "ended",
          title: "Ended",
          startDate: "2026-01-15T15:00:00.000Z",
          endDate: "2026-01-15T16:00:00.000Z",
        },
        {
          id: "cancelled",
          title: "Cancelled",
          startDate: "2026-01-15T17:10:00.000Z",
          endDate: "2026-01-15T17:40:00.000Z",
          status: "canceled",
        },
        {
          id: "later",
          title: "Later",
          startDate: "2026-01-15T19:00:00.000Z",
          endDate: "2026-01-15T20:00:00.000Z",
        },
        {
          id: "ongoing",
          title: "  Weekly sync  ",
          startDate: "2026-01-15T16:45:00.000Z",
          endDate: "2026-01-15T17:15:00.000Z",
          location: "https://meet.example.com/weekly",
        },
      ],
      now,
    );

    expect(next).toMatchObject({
      id: "ongoing",
      title: "Weekly sync",
      joinUrl: "https://meet.example.com/weekly",
    });
  });

  it("ignores invalid event dates", () => {
    expect(
      findNextUpcomingMeeting(
        [
          {
            id: "invalid",
            title: "Bad date",
            startDate: "not-a-date",
            endDate: "still-not-a-date",
          },
        ],
        now,
      ),
    ).toBeUndefined();
  });
});

describe("formatUpcomingMeetingTiming", () => {
  it("formats relative dates in the event time zone", () => {
    expect(
      formatUpcomingMeetingTiming(
        {
          startDate: new Date("2026-01-15T17:00:00.000Z"),
          endDate: new Date("2026-01-15T17:30:00.000Z"),
          allDay: false,
          timeZone: "America/Los_Angeles",
        },
        new Date("2026-01-15T16:00:00.000Z"),
        "en-US",
      ),
    ).toBe("Today · 9:00 AM PST – 9:30 AM PST");
  });

  it("identifies an active meeting", () => {
    expect(
      formatUpcomingMeetingTiming(
        {
          startDate: new Date("2026-01-15T16:30:00.000Z"),
          endDate: new Date("2026-01-15T17:30:00.000Z"),
          allDay: false,
          timeZone: "UTC",
        },
        new Date("2026-01-15T17:00:00.000Z"),
        "en-US",
      ),
    ).toBe("Happening now · Ends 5:30 PM UTC");
  });
});
