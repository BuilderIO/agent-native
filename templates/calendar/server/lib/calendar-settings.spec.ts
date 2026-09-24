import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const putSettingMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());
const mutateUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  getSetting: getSettingMock,
  getUserSetting: getUserSettingMock,
  putSetting: putSettingMock,
  putUserSetting: putUserSettingMock,
  mutateUserSetting: mutateUserSettingMock,
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
  // By default simulate no concurrent write racing ahead - the updater
  // sees the same "nothing saved yet" state readCalendarSettings already
  // observed.
  mutateUserSettingMock.mockImplementation(
    async (
      _email: string,
      _key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) => updater(null),
  );
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

  it("does not persist by default even when nothing is saved", async () => {
    getUserSettingMock.mockResolvedValue(null);
    await readCalendarSettings(EMAIL);
    expect(putUserSettingMock).not.toHaveBeenCalled();
    expect(putSettingMock).not.toHaveBeenCalled();
  });

  it("persists the detected zone once when asked and nothing is saved", async () => {
    getUserSettingMock.mockResolvedValue(null);
    await readCalendarSettings(EMAIL, { persistDetected: true });
    expect(mutateUserSettingMock).toHaveBeenCalledWith(
      EMAIL,
      "calendar-settings",
      expect.any(Function),
    );
    const updater = mutateUserSettingMock.mock.calls[0][2];
    expect(updater(null)).toEqual(
      expect.objectContaining({ timezone: "Pacific/Auckland" }),
    );
  });

  it("does not overwrite a concurrent explicit save that lands before the atomic write runs", async () => {
    getUserSettingMock.mockResolvedValue(null);
    await readCalendarSettings(EMAIL, { persistDetected: true });
    const updater = mutateUserSettingMock.mock.calls[0][2];
    const concurrentlySaved = { timezone: "Europe/Warsaw" };
    expect(updater(concurrentlySaved)).toBe(concurrentlySaved);
  });

  // A different user's first-time read must never touch the shared/global
  // key that backs another owner's already-customized public booking page.
  it("never writes the shared global key from a read, even when persisting", async () => {
    getUserSettingMock.mockResolvedValue(null);
    await readCalendarSettings(EMAIL, { persistDetected: true });
    expect(putSettingMock).not.toHaveBeenCalled();
  });

  it("never overwrites an existing saved record even when asked to persist", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "Europe/Warsaw" });
    await readCalendarSettings(EMAIL, { persistDetected: true });
    expect(mutateUserSettingMock).not.toHaveBeenCalled();
    expect(putSettingMock).not.toHaveBeenCalled();
  });

  it("does not persist a fallback default zone when nothing was actually detected", async () => {
    getRequestTimezoneMock.mockReturnValue(undefined);
    getUserSettingMock.mockResolvedValue(null);
    await readCalendarSettings(EMAIL, { persistDetected: true });
    expect(mutateUserSettingMock).not.toHaveBeenCalled();
    expect(putSettingMock).not.toHaveBeenCalled();
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
