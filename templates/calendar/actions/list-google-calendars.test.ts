import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const listGoogleCalendarsMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  mutateUserSetting: vi.fn(),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  listGoogleCalendars: listGoogleCalendarsMock,
}));

import action from "./list-google-calendars.js";

describe("list-google-calendars action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    getUserSettingMock.mockResolvedValue(null);
  });

  it("discovers sources for the authenticated owner", async () => {
    listGoogleCalendarsMock.mockResolvedValue({ calendars: [], errors: [] });

    await expect((action as any).run({})).resolves.toEqual({
      calendars: [],
      errors: [],
    });
    expect(listGoogleCalendarsMock).toHaveBeenCalledWith("owner@example.com");
  });

  it("says what each calendar's account is for", async () => {
    const calendar = {
      sourceKey: "s1",
      canonicalKey: "c1",
      calendarId: "primary",
      name: "Work",
      selected: true,
      primary: true,
      accessRole: "owner",
      readOnly: false,
    };
    listGoogleCalendarsMock.mockResolvedValue({
      calendars: [
        { ...calendar, accountEmail: "Work@Example.com" },
        { ...calendar, sourceKey: "s2", accountEmail: "me@example.com" },
      ],
      errors: [],
    });
    getUserSettingMock.mockResolvedValue({
      "work@example.com": "  Work   meetings and team 1:1s go here ",
      "me@example.com": "   ",
    });

    const result = await action.run({});

    expect(getUserSettingMock).toHaveBeenCalledWith(
      "owner@example.com",
      "calendar-account-descriptions",
    );
    expect(result.calendars).toEqual([
      expect.objectContaining({
        sourceKey: "s1",
        accountDescription: "Work meetings and team 1:1s go here",
      }),
      expect.not.objectContaining({ accountDescription: expect.anything() }),
    ]);
  });

  it("refuses unauthenticated discovery", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);

    await expect((action as any).run({})).rejects.toThrow(
      "no authenticated user",
    );
    expect(listGoogleCalendarsMock).not.toHaveBeenCalled();
  });
});
