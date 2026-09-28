import { describe, expect, it } from "vitest";

import {
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
