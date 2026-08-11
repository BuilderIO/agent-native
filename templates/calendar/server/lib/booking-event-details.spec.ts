import { describe, expect, it } from "vitest";

import {
  buildBookingEventAttendees,
  buildBookingEventTitle,
} from "./booking-event-details";

describe("booking event details", () => {
  it("generates host plus guest event titles instead of reusing the meeting type", () => {
    expect(
      buildBookingEventTitle({
        hostEmail: "steve@example.com",
        attendeeName: "Rakesh Rachamalla",
      }),
    ).toBe("Steve + Rakesh");
  });

  it("includes co-host first names in group booking titles", () => {
    expect(
      buildBookingEventTitle({
        hostEmail: "steve@example.com",
        hostEmails: ["brent@example.com"],
        attendeeName: "Rakesh Rachamalla",
      }),
    ).toBe("Steve + Brent + Rakesh");
  });

  it("still honors an explicit event title override", () => {
    expect(
      buildBookingEventTitle({
        explicitTitle: "Intro call",
        hostEmail: "steve@example.com",
        attendeeName: "Rakesh Rachamalla",
      }),
    ).toBe("Intro call");
  });

  it("includes the calendar account owner as the organizer", () => {
    expect(
      buildBookingEventAttendees({
        organizerEmail: "steve@example.com",
        attendeeEmail: "rakesh.rachamalla@walmart.com",
        attendeeName: "Rakesh Rachamalla",
      }),
    ).toEqual([
      {
        email: "steve@example.com",
        organizer: true,
        self: true,
        responseStatus: "accepted",
      },
      {
        email: "rakesh.rachamalla@walmart.com",
        displayName: "Rakesh Rachamalla",
      },
    ]);
  });

  it("adds co-hosts as Google Calendar attendees", () => {
    expect(
      buildBookingEventAttendees({
        organizerEmail: "steve@example.com",
        attendeeEmail: "rakesh.rachamalla@walmart.com",
        attendeeName: "Rakesh Rachamalla",
        hostEmails: ["brent@example.com"],
      }),
    ).toEqual([
      {
        email: "steve@example.com",
        organizer: true,
        self: true,
        responseStatus: "accepted",
      },
      {
        email: "rakesh.rachamalla@walmart.com",
        displayName: "Rakesh Rachamalla",
      },
      {
        email: "brent@example.com",
        displayName: "Brent",
      },
    ]);
  });
});
