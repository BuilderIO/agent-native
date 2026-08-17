import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));

import { getEligibleHostAvailability } from "./booking-host-availability";

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

  it("falls back to calendar-settings.timezone when no schedule saved", async () => {
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
        if (email === "peer@example.com" && key === "calendar-settings") {
          return { timezone: "Europe/Berlin" };
        }
        return null;
      },
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      { email: "peer@example.com", timezone: "Europe/Berlin" },
    ]);
  });

  it("prefers calendar-availability.timezone over calendar-settings.timezone", async () => {
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
        if (email === "peer@example.com" && key === "calendar-settings") {
          return { timezone: "Europe/Berlin" };
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
