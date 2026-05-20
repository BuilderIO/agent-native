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

  it("still honors an explicit event title override", () => {
    expect(
      buildBookingEventTitle({
        explicitTitle: "Intro call",
        hostEmail: "steve@example.com",
        attendeeName: "Rakesh Rachamalla",
      }),
    ).toBe("Intro call");
  });

  it("builds a Google Calendar attendee for the booker", () => {
    expect(
      buildBookingEventAttendees({
        attendeeEmail: "rakesh.rachamalla@walmart.com",
        attendeeName: "Rakesh Rachamalla",
      }),
    ).toEqual([
      {
        email: "rakesh.rachamalla@walmart.com",
        displayName: "Rakesh Rachamalla",
      },
    ]);
  });
});
