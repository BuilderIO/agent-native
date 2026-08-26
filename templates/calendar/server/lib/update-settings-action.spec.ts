import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const putSettingMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: <T>(action: T) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  putSetting: putSettingMock,
  putUserSetting: putUserSettingMock,
}));

import action from "../../actions/update-settings";

describe("update-settings timezone validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestTimezoneMock.mockReturnValue("America/New_York");
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    getUserSettingMock.mockResolvedValue(null);
    putSettingMock.mockResolvedValue(undefined);
    putUserSettingMock.mockResolvedValue(undefined);
  });

  it("rejects an invalid IANA timezone at the action boundary", () => {
    // The framework validates against `schema` before `run`; the mocked
    // defineAction hands the definition back as-is, so reach it directly.
    const { schema } = action as unknown as { schema: z.ZodTypeAny };
    expect(schema.safeParse({ timezone: "not-a-timezone" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ timezone: "Europe/Warsaw" }).success).toBe(true);
  });

  it("saves a valid timezone", async () => {
    const settings = {
      timezone: "Europe/Warsaw",
      bookingPageTitle: "Book a Meeting",
      bookingPageDescription: "Select a time.",
      defaultEventDuration: 30,
    };

    const saved = { ...settings, weekStart: "sunday" };
    await expect(action.run(settings)).resolves.toEqual(saved);
    expect(putUserSettingMock).toHaveBeenCalledWith(
      "owner@example.com",
      "calendar-settings",
      saved,
    );
  });
});
