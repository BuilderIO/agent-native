import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const putSettingMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  getSetting: getSettingMock,
  getUserSetting: getUserSettingMock,
  putSetting: putSettingMock,
  putUserSetting: putUserSettingMock,
}));

import {
  getCalendarTimezone,
  readCalendarSettings,
  readPublicCalendarSettings,
  saveCalendarSettings,
} from "./calendar-settings";

const EMAIL = "owner@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  getRequestTimezoneMock.mockReturnValue("Pacific/Auckland");
  putSettingMock.mockResolvedValue(undefined);
  putUserSettingMock.mockResolvedValue(undefined);
});

describe("readCalendarSettings", () => {
  it("keeps a usable saved timezone", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "Europe/Warsaw" });
    await expect(readCalendarSettings(EMAIL)).resolves.toMatchObject({
      timezone: "Europe/Warsaw",
    });
  });

  it("uses the caller's zone when none is saved", async () => {
    getUserSettingMock.mockResolvedValue(null);
    await expect(readCalendarSettings(EMAIL)).resolves.toMatchObject({
      timezone: "Pacific/Auckland",
    });
  });

  it("replaces a timezone an older build stored in an unsupported format", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "GMT+2" });
    await expect(readCalendarSettings(EMAIL)).resolves.toMatchObject({
      timezone: "Pacific/Auckland",
    });
  });
});

describe("readPublicCalendarSettings", () => {
  // A visitor's own zone must never shift the owner's published booking times.
  it("uses the fixed default rather than the visitor's zone", async () => {
    getSettingMock.mockResolvedValue(null);
    await expect(readPublicCalendarSettings()).resolves.toMatchObject({
      timezone: "America/New_York",
    });
  });
});

describe("saveCalendarSettings", () => {
  it("merges a patch over the stored settings and writes both keys", async () => {
    getUserSettingMock.mockResolvedValue({
      timezone: "Europe/Warsaw",
      bookingPageTitle: "Book",
    });

    const saved = await saveCalendarSettings(EMAIL, { weekStart: "monday" });

    expect(saved).toMatchObject({
      timezone: "Europe/Warsaw",
      bookingPageTitle: "Book",
      weekStart: "monday",
    });
    expect(putUserSettingMock).toHaveBeenCalledWith(
      EMAIL,
      "calendar-settings",
      saved,
    );
    expect(putSettingMock).toHaveBeenCalledWith("calendar-settings", saved);
  });

  // Saving an unrelated field must not quietly move an account to the fixed
  // default zone after it was read as the caller's.
  it("does not overwrite the timezone a read would have returned", async () => {
    getUserSettingMock.mockResolvedValue(null);

    const read = await readCalendarSettings(EMAIL);
    const saved = await saveCalendarSettings(EMAIL, { weekStart: "monday" });

    expect(saved.timezone).toBe(read.timezone);
    expect(saved.timezone).toBe("Pacific/Auckland");
  });

  it("ignores a patch that is not an object", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "Europe/Warsaw" });
    await expect(
      saveCalendarSettings(EMAIL, "nonsense"),
    ).resolves.toMatchObject({ timezone: "Europe/Warsaw" });
  });
});

describe("getCalendarTimezone", () => {
  // The grid and the settings page resolve through the same read, so they can
  // never render an account in different zones.
  it("matches what the settings read returns", async () => {
    for (const stored of [
      null,
      {},
      { timezone: "Europe/Warsaw" },
      { timezone: "GMT+2" },
      { timezone: 42 },
    ]) {
      getUserSettingMock.mockResolvedValue(stored);
      await expect(getCalendarTimezone(EMAIL)).resolves.toBe(
        (await readCalendarSettings(EMAIL)).timezone,
      );
    }
  });

  it("resolves a usable zone for a legacy account instead of throwing", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "not-a-timezone" });
    await expect(getCalendarTimezone(EMAIL)).resolves.toBe("Pacific/Auckland");
  });
});
