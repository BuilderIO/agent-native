import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSettingMock = vi.hoisted(() => vi.fn());
const getGoogleAccountTimezoneMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));
vi.mock("./google-calendar.js", () => ({
  getGoogleAccountTimezone: getGoogleAccountTimezoneMock,
}));

import type { BookingLink } from "../../shared/api";
import {
  getEligibleHostAvailability,
  getHostSchedulingStatus,
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

// Most tests exercise a fully reciprocal owner<->peer overlay relationship,
// so their `calendar-overlay-people` mock also needs to answer for the
// peer's own settings read (peer must have overlaid the owner back).
function withReciprocalOverlay(
  peerEmail: string,
  handleOtherKeys: (email: string, key: string) => unknown,
) {
  return async (email: string, key: string) => {
    if (email === "owner@example.com" && key === "calendar-overlay-people") {
      return { people: [{ email: peerEmail, color: "#fff" }] };
    }
    if (email === peerEmail && key === "calendar-overlay-people") {
      return { people: [{ email: "owner@example.com", color: "#fff" }] };
    }
    return handleOtherKeys(email, key);
  };
}

describe("getEligibleHostAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleAccountTimezoneMock.mockResolvedValue(null);
  });

  it("returns nothing when the owner has no overlay people", async () => {
    getUserSettingMock.mockResolvedValue(null);

    await expect(
      getEligibleHostAvailability("owner@example.com", ["cohost@example.com"]),
    ).resolves.toEqual([]);
  });

  it("skips hosts not in the owner's overlay list", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", () => null),
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", [
        "stranger@example.com",
      ]),
    ).resolves.toEqual([]);
  });

  it("skips an overlaid host who has not reciprocally overlaid the owner back", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (
          email === "owner@example.com" &&
          key === "calendar-overlay-people"
        ) {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        // peer's own overlay list is empty (or doesn't include the owner) -
        // the owner added peer, but peer never added the owner back.
        if (email === "peer@example.com" && key === "calendar-overlay-people") {
          return { people: [] };
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
    ).resolves.toEqual([]);
  });

  it("returns schedule and timezone for an overlaid host with saved availability", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", (email, key) => {
        if (email === "peer@example.com" && key === "calendar-availability") {
          return {
            timezone: "America/Chicago",
            weeklySchedule: WEEKLY_SCHEDULE,
          };
        }
        return null;
      }),
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

  it("falls back to free/busy-only for an overlaid host with no saved schedule or Google time zone", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", () => null),
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([{ email: "peer@example.com" }]);
  });

  it("omits the schedule when a host has one but no time zone resolves from any source", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", (email, key) => {
        if (email === "peer@example.com" && key === "calendar-availability") {
          return { weeklySchedule: WEEKLY_SCHEDULE };
        }
        return null;
      }),
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([{ email: "peer@example.com" }]);
  });

  it("falls back to calendar-settings.timezone when no schedule saved", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", (email, key) => {
        if (email === "peer@example.com" && key === "calendar-availability") {
          return null;
        }
        if (email === "peer@example.com" && key === "calendar-settings") {
          return { timezone: "Europe/Berlin" };
        }
        return null;
      }),
    );

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      { email: "peer@example.com", timezone: "Europe/Berlin" },
    ]);
  });

  it("falls back to the peer's connected Google account time zone when nothing is saved", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", () => null),
    );
    getGoogleAccountTimezoneMock.mockResolvedValue("America/Chicago");

    await expect(
      getEligibleHostAvailability("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      { email: "peer@example.com", timezone: "America/Chicago" },
    ]);
    expect(getGoogleAccountTimezoneMock).toHaveBeenCalledWith(
      "peer@example.com",
    );
  });

  it("prefers calendar-availability.timezone over calendar-settings.timezone", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", (email, key) => {
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
      }),
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

describe("getHostSchedulingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleAccountTimezoneMock.mockResolvedValue(null);
  });

  it("reports not-overlaid when the host is not in the owner's overlay list", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", () => null),
    );

    await expect(
      getHostSchedulingStatus("owner@example.com", ["stranger@example.com"]),
    ).resolves.toEqual([
      { email: "stranger@example.com", status: "not-overlaid" },
    ]);
  });

  it("reports awaiting-reciprocal-overlay when the peer has not added the owner back", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (
          email === "owner@example.com" &&
          key === "calendar-overlay-people"
        ) {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        if (email === "peer@example.com" && key === "calendar-overlay-people") {
          return { people: [] };
        }
        return null;
      },
    );

    await expect(
      getHostSchedulingStatus("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      { email: "peer@example.com", status: "awaiting-reciprocal-overlay" },
    ]);
  });

  it("reports missing-schedule when the overlay is reciprocal but no schedule is saved", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", () => null),
    );

    await expect(
      getHostSchedulingStatus("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      { email: "peer@example.com", status: "missing-schedule" },
    ]);
  });

  it("reports missing-timezone when a schedule is saved but no time zone can be resolved", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", (email, key) => {
        if (email === "peer@example.com" && key === "calendar-availability") {
          return { weeklySchedule: WEEKLY_SCHEDULE };
        }
        return null;
      }),
    );

    await expect(
      getHostSchedulingStatus("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      { email: "peer@example.com", status: "missing-timezone" },
    ]);
  });

  it("reports active when the overlay is reciprocal and a schedule and time zone are saved", async () => {
    getUserSettingMock.mockImplementation(
      withReciprocalOverlay("peer@example.com", (email, key) => {
        if (email === "peer@example.com" && key === "calendar-availability") {
          return {
            timezone: "America/Chicago",
            weeklySchedule: WEEKLY_SCHEDULE,
          };
        }
        return null;
      }),
    );

    await expect(
      getHostSchedulingStatus("owner@example.com", ["peer@example.com"]),
    ).resolves.toEqual([
      {
        email: "peer@example.com",
        status: "active",
        timezone: "America/Chicago",
      },
    ]);
  });

  it("never reports a status for the owner's own email", async () => {
    getUserSettingMock.mockResolvedValue(null);

    await expect(
      getHostSchedulingStatus("owner@example.com", ["owner@example.com"]),
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
    expect(result.publicHosts).toEqual([
      { id: "host-0", label: "Peer", timezone: "America/Chicago" },
      { id: "host-1", label: "Stranger", timezone: undefined },
    ]);
  });

  it("never returns the admin-only hosts field with raw emails", () => {
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

    expect(result.hosts).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("weeklySchedule");
    expect(JSON.stringify(result)).not.toContain("peer@example.com");
    expect(JSON.stringify(result)).not.toContain("stranger@example.com");
  });

  it("uses a host's displayName when set, instead of deriving one from email", () => {
    const link = bookingLink();
    link.hosts = [{ email: "peer@example.com", displayName: "Peer Person" }];
    const result = withHostTimezones(link, "America/New_York", []);

    expect(result.publicHosts).toEqual([
      { id: "host-0", label: "Peer Person", timezone: undefined },
    ]);
  });

  it("leaves publicHosts timezone unset when no eligible host timezone resolves", () => {
    const link = bookingLink();
    const result = withHostTimezones(link, "America/New_York", [
      { email: "peer@example.com" },
    ]);

    expect(
      result.publicHosts?.every((host) => host.timezone === undefined),
    ).toBe(true);
  });
});
