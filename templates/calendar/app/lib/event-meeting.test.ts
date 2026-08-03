import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import { extractMeetingLink } from "./event-meeting";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Team sync",
    description: "",
    location: "",
    start: "2026-07-10T16:00:00.000Z",
    end: "2026-07-10T17:00:00.000Z",
    allDay: false,
    source: "google",
    createdAt: "2026-07-10T15:00:00.000Z",
    updatedAt: "2026-07-10T15:00:00.000Z",
    attendees: [],
    ...overrides,
  };
}

describe("extractMeetingLink", () => {
  it("prefers the provider meeting link", () => {
    expect(
      extractMeetingLink(
        event({
          meetingLink: "https://meet.google.com/abc-defg-hij",
          description: "Backup https://zoom.us/j/123",
        }),
      ),
    ).toEqual({
      url: "https://meet.google.com/abc-defg-hij",
      type: "meet",
    });
  });

  it("preserves conference entry-point metadata", () => {
    expect(
      extractMeetingLink(
        event({
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://zoom.us/j/123",
                label: "Zoom",
                pin: "123",
                passcode: "456",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      url: "https://zoom.us/j/123",
      type: "zoom",
      label: "Zoom",
      pin: "123",
      passcode: "456",
    });
  });

  it("finds a supported meeting URL in event text", () => {
    expect(
      extractMeetingLink(
        event({
          description:
            "Join at https://teams.microsoft.com/l/meetup-join/abc when ready",
        }),
      ),
    ).toEqual({
      url: "https://teams.microsoft.com/l/meetup-join/abc",
      type: "teams",
    });
  });

  it("returns null when no meeting access exists", () => {
    expect(extractMeetingLink(event({ location: "Room A" }))).toBeNull();
  });
});
