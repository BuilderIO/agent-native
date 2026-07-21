import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));

import type { BookingLink } from "../../shared/api";
import {
  getEligibleHostAvailability,
  withHostTimezones,
} from "./booking-host-availability";

const WEEKLY_SCHEDULE = {
  monday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
  tuesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
  wednesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
  thursday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
  friday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
  saturday: { enabled: false, slots: [] },
  sunday: { enabled: false, slots: [] },
};

describe("getEligibleHostAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns nothing when the owner has no overlay people", async () => {
    getUserSettingMock.mockResolvedValue(null);

    await expect(
      getEligibleHostAvailability("owner@example.com", ["cohost@example.com"]),
    ).resolves.toEqual([]);
  });

  it("skips hosts not in the owner's overlay list", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (
          email === "owner@example.com" &&
          key === "calendar-overlay-people"
        ) {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        return null;
      },
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", [
        "stranger@example.com",
      ]),
    ).resolves.toEqual([]);
  });

  it("returns schedule and timezone for an overlaid host with saved availability", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (
          email === "owner@example.com" &&
          key === "calendar-overlay-people"
        ) {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        if (email === "peer@example.com" && key === "calendar-availability") {
          return {
            timezone: "America/Chicago",
            weeklySchedule: WEEKLY_SCHEDULE,
          };
        }
        return null;
      },
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      {
        email: "peer@example.com",
        weeklySchedule: WEEKLY_SCHEDULE,
        timezone: "America/Chicago",
      },
    ]);
  });

  it("falls back to free/busy-only for an overlaid host with no saved schedule", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (
          email === "owner@example.com" &&
          key === "calendar-overlay-people"
        ) {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        if (email === "peer@example.com" && key === "calendar-availability") {
          return null;
        }
        return null;
      },
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([{ email: "peer@example.com" }]);
  });

  it("never treats the owner as their own eligible host", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (
          email === "owner@example.com" &&
          key === "calendar-overlay-people"
        ) {
          return { people: [{ email: "owner@example.com", color: "#fff" }] };
        }
        return null;
      },
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["owner@example.com"]),
    ).resolves.toEqual([]);
  });
});

describe("withHostTimezones", () => {
  function bookingLink(): BookingLink {
    return {
      id: "link-1",
      slug: "team-sync",
      title: "Team Sync",
      duration: 30,
      hosts: [{ email: "peer@example.com" }, { email: "stranger@example.com" }],
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("attaches the owner timezone and only eligible hosts' timezones", () => {
    const result = withHostTimezones(bookingLink(), "America/New_York", [
      { email: "peer@example.com", timezone: "America/Chicago" },
    ]);

    expect(result.ownerTimezone).toBe("America/New_York");
    expect(result.hosts).toEqual([
      { email: "peer@example.com", timezone: "America/Chicago" },
      { email: "stranger@example.com" },
    ]);
  });

  it("never leaks schedule data onto the public response", () => {
    const result = withHostTimezones(bookingLink(), "America/New_York", [
      {
        email: "peer@example.com",
        timezone: "America/Chicago",
        weeklySchedule: {
          monday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
          tuesday: { enabled: false, slots: [] },
          wednesday: { enabled: false, slots: [] },
          thursday: { enabled: false, slots: [] },
          friday: { enabled: false, slots: [] },
          saturday: { enabled: false, slots: [] },
          sunday: { enabled: false, slots: [] },
        },
      },
    ]);

    expect(result.hosts?.[0]).toEqual({
      email: "peer@example.com",
      timezone: "America/Chicago",
    });
    expect(JSON.stringify(result)).not.toContain("weeklySchedule");
  });

  it("leaves hosts unchanged when no eligible host timezone resolves", () => {
    const link = bookingLink();
    const result = withHostTimezones(link, "America/New_York", [
      { email: "peer@example.com" },
    ]);

    expect(result.hosts).toEqual(link.hosts);
  });
});
