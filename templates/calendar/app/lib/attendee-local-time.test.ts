import { describe, expect, it } from "vitest";

import {
  formatAttendeeLocalTime,
  getAttendeeLocalTimeLabel,
  isSelfAttendee,
  isValidIanaTimeZone,
  resolveAttendeeTimeZone,
} from "./attendee-local-time";

describe("isSelfAttendee", () => {
  it("treats attendee.self as self", () => {
    expect(
      isSelfAttendee(
        { email: "a@example.com", self: true },
        "other@example.com",
      ),
    ).toBe(true);
  });

  it("matches account email case-insensitively", () => {
    expect(isSelfAttendee({ email: "Me@Example.com" }, "me@example.com")).toBe(
      true,
    );
  });

  it("returns false for other attendees", () => {
    expect(
      isSelfAttendee({ email: "guest@example.com" }, "me@example.com"),
    ).toBe(false);
  });
});

describe("isValidIanaTimeZone", () => {
  it("accepts known IANA zones", () => {
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
  });

  it("rejects empty or invalid zones", () => {
    expect(isValidIanaTimeZone("")).toBe(false);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
    expect(isValidIanaTimeZone(null)).toBe(false);
  });
});

describe("resolveAttendeeTimeZone", () => {
  it("uses event start timezone for self", () => {
    expect(
      resolveAttendeeTimeZone({
        attendee: { email: "me@example.com", self: true },
        accountEmail: "me@example.com",
        eventStartTimeZone: "America/Los_Angeles",
      }),
    ).toBe("America/Los_Angeles");
  });

  it("falls back to browser timezone for self when event has none", () => {
    expect(
      resolveAttendeeTimeZone({
        attendee: { email: "me@example.com", self: true },
        browserTimeZone: "Europe/London",
      }),
    ).toBe("Europe/London");
  });

  it("uses attendee.timeZone when present", () => {
    expect(
      resolveAttendeeTimeZone({
        attendee: {
          email: "guest@example.com",
          timeZone: "Asia/Tokyo",
        },
      }),
    ).toBe("Asia/Tokyo");
  });

  it("uses user overrides for other attendees", () => {
    expect(
      resolveAttendeeTimeZone({
        attendee: { email: "Guest@Example.com" },
        overrides: { "guest@example.com": "America/Chicago" },
      }),
    ).toBe("America/Chicago");
  });

  it("returns null when timezone is unknown", () => {
    expect(
      resolveAttendeeTimeZone({
        attendee: { email: "guest@example.com" },
      }),
    ).toBeNull();
  });
});

describe("formatAttendeeLocalTime", () => {
  it("formats a short local time with zone abbreviation", () => {
    // 2024-06-15 18:30 UTC → 2:30 PM EDT in America/New_York
    const label = formatAttendeeLocalTime(
      "2024-06-15T18:30:00.000Z",
      "America/New_York",
    );
    expect(label).toMatch(/2:30\s*PM/);
    expect(label).toMatch(/EDT|GMT-4/);
  });

  it("returns null for invalid inputs", () => {
    expect(
      formatAttendeeLocalTime("not-a-date", "America/New_York"),
    ).toBeNull();
    expect(
      formatAttendeeLocalTime("2024-06-15T18:30:00.000Z", "Not/AZone"),
    ).toBeNull();
  });
});

describe("getAttendeeLocalTimeLabel", () => {
  it("returns a label when timezone can be resolved", () => {
    const label = getAttendeeLocalTimeLabel({
      attendee: { email: "me@example.com", self: true },
      accountEmail: "me@example.com",
      eventStartTimeZone: "America/New_York",
      startIso: "2024-06-15T18:30:00.000Z",
    });
    expect(label).toMatch(/2:30\s*PM/);
  });

  it("returns null when timezone cannot be resolved", () => {
    expect(
      getAttendeeLocalTimeLabel({
        attendee: { email: "guest@example.com" },
        startIso: "2024-06-15T18:30:00.000Z",
      }),
    ).toBeNull();
  });
});
