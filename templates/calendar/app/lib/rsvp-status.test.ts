import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import { canInlineRsvp, hasTimeProposal } from "./rsvp-status";

describe("canInlineRsvp", () => {
  it("allows RSVP controls on owned Google events", () => {
    expect(canInlineRsvp({ source: "google" })).toBe(true);
  });

  it("hides RSVP controls on overlaid calendar copies", () => {
    expect(
      canInlineRsvp({
        source: "google",
        overlayEmail: "teammate@example.com",
      }),
    ).toBe(false);
  });

  it("hides RSVP controls for non-Google events", () => {
    expect(canInlineRsvp({ source: "ical" })).toBe(false);
  });
});

describe("hasTimeProposal", () => {
  it("requires a proposal comment instead of treating tentative as a proposal", () => {
    const event: Pick<CalendarEvent, "attendees"> = {
      attendees: [
        { email: "owner@example.com", self: true },
        { email: "guest@example.com", responseStatus: "tentative" },
      ],
    };

    expect(hasTimeProposal(event)).toBe(false);
    expect(
      hasTimeProposal({
        attendees: [
          ...event.attendees!,
          {
            email: "second-guest@example.com",
            comment: "Proposal: Sep 11, 1-1:30pm",
          },
        ],
      }),
    ).toBe(true);
  });
});
