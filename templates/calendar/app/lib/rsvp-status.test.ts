import { describe, expect, it } from "vitest";

import { canInlineRsvp } from "./rsvp-status";

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
