import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));

import {
  DEFAULT_BOOKING_TIMEZONE,
  getOwnerBookingTimeZone,
  safeBookingTimeZone,
} from "./booking-timezone";

describe("booking timezone resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the booking availability timezone before calendar settings", async () => {
    getUserSettingMock.mockImplementation(
      async (_ownerEmail: string, key: string) => {
        if (key === "calendar-availability") {
          return { timezone: "America/Los_Angeles" };
        }
        if (key === "calendar-settings") {
          return { timezone: "Europe/London" };
        }
        return null;
      },
    );

    await expect(getOwnerBookingTimeZone("host@example.com")).resolves.toBe(
      "America/Los_Angeles",
    );
  });

  it("falls back to the owner's calendar timezone when availability has none", async () => {
    getUserSettingMock.mockImplementation(
      async (_ownerEmail: string, key: string) => {
        if (key === "calendar-availability") {
          return { timezone: "" };
        }
        if (key === "calendar-settings") {
          return { timezone: "America/Los_Angeles" };
        }
        return null;
      },
    );

    await expect(getOwnerBookingTimeZone("host@example.com")).resolves.toBe(
      "America/Los_Angeles",
    );
  });

  it("uses the booking default instead of UTC when no owner timezone exists", async () => {
    getUserSettingMock.mockResolvedValue(null);

    await expect(getOwnerBookingTimeZone("host@example.com")).resolves.toBe(
      DEFAULT_BOOKING_TIMEZONE,
    );
  });

  it("rejects invalid timezone names", () => {
    expect(safeBookingTimeZone("America/Los_Angeles")).toBe(
      "America/Los_Angeles",
    );
    expect(safeBookingTimeZone("Pacific")).toBeUndefined();
  });
});
