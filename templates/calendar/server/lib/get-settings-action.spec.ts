import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: <T>(action: T) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));

import action from "../../actions/get-settings";

describe("get-settings timezone default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    getRequestTimezoneMock.mockReturnValue("Pacific/Auckland");
  });

  it("uses the caller timezone for an account without saved settings", async () => {
    getUserSettingMock.mockResolvedValue(null);

    await expect(action.run({})).resolves.toMatchObject({
      timezone: "Pacific/Auckland",
      bookingPageTitle: "Book a Meeting",
      defaultEventDuration: 30,
    });
  });

  it("keeps saved settings instead of replacing their timezone", async () => {
    getUserSettingMock.mockResolvedValue({
      timezone: "America/New_York",
      bookingPageTitle: "Saved title",
      bookingPageDescription: "Saved description",
      defaultEventDuration: 45,
    });

    await expect(action.run({})).resolves.toMatchObject({
      timezone: "America/New_York",
      bookingPageTitle: "Saved title",
    });
  });
});
