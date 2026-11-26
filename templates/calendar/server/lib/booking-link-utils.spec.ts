import { describe, expect, it } from "vitest";

import {
  bookingReminderMinutesSchema,
  getBookingLinkRequiredHostEmails,
  isBookingLinkHost,
  normalizeBookingHosts,
  serializeBookingHosts,
} from "./booking-link-utils";

describe("booking link host utilities", () => {
  it("normalizes co-hosts, removes duplicates, and excludes the owner", () => {
    expect(
      normalizeBookingHosts(
        [
          "BRENT@example.com",
          { email: "brent@example.com", displayName: "Brent" },
          "steve@example.com",
          "bad-email",
        ],
        "steve@example.com",
      ),
    ).toEqual([{ email: "brent@example.com" }]);
  });

  it("serializes empty host lists as null", () => {
    expect(
      serializeBookingHosts(["steve@example.com"], "steve@example.com"),
    ).toBe(null);
  });

  it("returns the owner and co-hosts as required hosts", () => {
    const link = {
      ownerEmail: "steve@example.com",
      hosts: JSON.stringify([{ email: "brent@example.com" }]),
    };
    expect(getBookingLinkRequiredHostEmails(link)).toEqual([
      "steve@example.com",
      "brent@example.com",
    ]);
    expect(isBookingLinkHost(link, "STEVE@example.com")).toBe(true);
    expect(isBookingLinkHost(link, "brent@example.com")).toBe(true);
    expect(isBookingLinkHost(link, "viewer@example.com")).toBe(false);
    expect(isBookingLinkHost(link, null)).toBe(false);
  });
});

describe("booking reminder setting", () => {
  it("accepts the three choices, as numbers or digit strings", () => {
    expect(bookingReminderMinutesSchema.parse(0)).toBe(0);
    expect(bookingReminderMinutesSchema.parse("60")).toBe(60);
    expect(bookingReminderMinutesSchema.parse(" 1440 ")).toBe(1440);
  });

  it("rejects an empty value rather than reading it as off", () => {
    for (const value of [null, "", "  ", 30, "1 day"]) {
      expect(bookingReminderMinutesSchema.safeParse(value).success).toBe(false);
    }
  });
});
