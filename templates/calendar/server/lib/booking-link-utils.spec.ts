import { describe, expect, it } from "vitest";

import {
  getBookingLinkRequiredHostEmails,
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
    expect(
      getBookingLinkRequiredHostEmails({
        ownerEmail: "steve@example.com",
        hosts: JSON.stringify([{ email: "brent@example.com" }]),
      }),
    ).toEqual(["steve@example.com", "brent@example.com"]);
  });
});
