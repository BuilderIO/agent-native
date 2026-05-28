import { describe, expect, it } from "vitest";
import {
  normalizeBookingDurationInput,
  parseBookingLinkDurations,
  resolveAvailabilityDuration,
} from "./booking-durations";

describe("booking duration helpers", () => {
  it("uses the primary duration when a link has no duration options", () => {
    expect(
      parseBookingLinkDurations({ duration: 60, durations: null }),
    ).toEqual([60]);
  });

  it("normalizes duration options from stored JSON", () => {
    expect(
      parseBookingLinkDurations({
        duration: 30,
        durations: JSON.stringify([15, "60", 60, 0, 2000]),
      }),
    ).toEqual([15, 60]);
  });

  it("normalizes a single selected duration over a stale scalar duration", () => {
    expect(
      normalizeBookingDurationInput({
        duration: 30,
        durations: [60],
      }),
    ).toEqual({ duration: 60 });
  });

  it("keeps a valid scalar duration for multi-duration links", () => {
    expect(
      normalizeBookingDurationInput({
        duration: 60,
        durations: [30, 60],
      }),
    ).toEqual({ duration: 60, durations: [30, 60] });
  });

  it("defaults availability requests to the booking link duration", () => {
    expect(
      resolveAvailabilityDuration({
        rawDuration: undefined,
        bookingLink: { duration: 60, durations: null },
        availability: { slotDurationMinutes: 30 },
      }),
    ).toEqual({ duration: 60 });
  });

  it("rejects unavailable durations for a booking link", () => {
    expect(
      resolveAvailabilityDuration({
        rawDuration: "30",
        bookingLink: { duration: 60, durations: null },
        availability: { slotDurationMinutes: 30 },
      }),
    ).toEqual({ error: "duration is not available for this booking link" });
  });

  it("falls back to availability duration when there is no booking link", () => {
    expect(
      resolveAvailabilityDuration({
        rawDuration: undefined,
        availability: { slotDurationMinutes: 45 },
      }),
    ).toEqual({ duration: 45 });
  });
});
