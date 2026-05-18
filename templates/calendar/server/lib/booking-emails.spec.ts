import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  emailLink: (label: string, url: string) => `${label}: ${url}`,
  emailStrong: (value: string) => value,
  isEmailConfigured: () => false,
  renderEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

import { formatBookingWhen } from "./booking-emails";

describe("booking email time formatting", () => {
  it("formats booking times in the provided booking-link timezone", () => {
    expect(
      formatBookingWhen(
        "2026-05-21T19:30:00.000Z",
        "2026-05-21T20:00:00.000Z",
        "America/Los_Angeles",
      ),
    ).toBe("Thursday, May 21, 2026, 12:30 PM PDT - 1:00 PM PDT");
  });
});
