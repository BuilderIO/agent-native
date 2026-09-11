import { describe, expect, it } from "vitest";

import {
  hasExplicitMeetingLink,
  shouldAutoAddGoogleMeet,
} from "./event-video-conferencing";

describe("calendar event video conferencing defaults", () => {
  it("auto-adds Google Meet for normal events with invited guests", () => {
    expect(
      shouldAutoAddGoogleMeet({
        eventType: "default",
        attendees: [
          {
            email: "host@example.com",
            organizer: true,
            self: true,
          },
          { email: "guest@example.com" },
        ],
      }),
    ).toBe(true);
  });

  it("does not auto-add Google Meet when conferencing was explicitly chosen", () => {
    expect(
      shouldAutoAddGoogleMeet(
        {
          attendees: [{ email: "guest@example.com" }],
        },
        { addGoogleMeet: false },
      ),
    ).toBe(false);
    expect(
      shouldAutoAddGoogleMeet(
        {
          attendees: [{ email: "guest@example.com" }],
        },
        { addZoom: true },
      ),
    ).toBe(false);
  });

  it("does not auto-add Google Meet to solo or non-default events", () => {
    expect(
      shouldAutoAddGoogleMeet({
        attendees: [
          {
            email: "host@example.com",
            organizer: true,
            self: true,
          },
        ],
      }),
    ).toBe(false);
    expect(
      shouldAutoAddGoogleMeet({
        eventType: "focusTime",
        attendees: [{ email: "guest@example.com" }],
      }),
    ).toBe(false);
  });

  it("detects existing video links before creating another conference", () => {
    expect(
      hasExplicitMeetingLink({
        location: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(true);
    expect(
      shouldAutoAddGoogleMeet({
        attendees: [{ email: "guest@example.com" }],
        description: "Join here: https://teams.microsoft.com/l/meetup-join/123",
      }),
    ).toBe(false);
    expect(
      shouldAutoAddGoogleMeet({
        attendees: [{ email: "guest@example.com" }],
        description: "Join Webex: https://acme.webex.com/meet/sarah",
      }),
    ).toBe(false);
  });
});
