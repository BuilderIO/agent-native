import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const putSettingMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: <T>(action: T) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  putSetting: putSettingMock,
  putUserSetting: putUserSettingMock,
}));

import action from "../../actions/update-settings";
import { isCalendarTimezone } from "./calendar-settings";

describe("update-settings timezone validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    putSettingMock.mockResolvedValue(undefined);
    putUserSettingMock.mockResolvedValue(undefined);
  });

  it("rejects invalid IANA timezones", () => {
    expect(isCalendarTimezone("not-a-timezone")).toBe(false);
  });

  it("saves a valid timezone", async () => {
    const settings = {
      timezone: "Europe/Warsaw",
      bookingPageTitle: "Book a Meeting",
      bookingPageDescription: "Select a time.",
      defaultEventDuration: 30,
    };

    await expect(action.run(settings)).resolves.toEqual(settings);
    expect(putUserSettingMock).toHaveBeenCalledWith(
      "owner@example.com",
      "calendar-settings",
      settings,
    );
  });
});
