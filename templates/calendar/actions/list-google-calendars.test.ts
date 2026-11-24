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

  it("reports a throttled source discovery to the calendar instead of returning incomplete sources", async () => {
    listGoogleCalendarsMock.mockResolvedValue({
      calendars: [],
      errors: [
        {
          email: "owner@example.com",
          error: "Throttled",
          code: "RATE_LIMITED",
        },
      ],
    });
    await expect(action.run({ strict: true })).rejects.toMatchObject({
      errorCode: "calendar_rate_limited",
      statusCode: 429,
    });
  });

  it("includes successfully discovered calendars with a typed partial failure", async () => {
    const calendar = {
      sourceKey: "healthy",
      calendarId: "healthy@example.test",
      accountEmail: "healthy@example.test",
      canonicalKey: "healthy",
      name: "Healthy",
      primary: true,
      selected: true,
      accessRole: "owner",
      readOnly: false,
    };
    listGoogleCalendarsMock.mockResolvedValue({
      calendars: [calendar],
      errors: [
        {
          email: "other@example.test",
          error: "Throttled",
          code: "RATE_LIMITED",
        },
      ],
    });
    await expect(action.run({ strict: true })).rejects.toMatchObject({
      errorCode: "calendar_rate_limited",
      details: { calendars: [calendar] },
    });
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

  it("describes a merged primary calendar by the account it belongs to", async () => {
    listGoogleCalendarsMock.mockResolvedValue({
      calendars: [
        {
          sourceKey: "s1",
          canonicalKey: "c1",
          accountEmail: "assistant@example.com",
          calendarId: "work@example.com",
          name: "work@example.com",
          selected: true,
          primary: true,
          accessRole: "owner",
          readOnly: false,
          sourcePaths: [
            {
              sourceKey: "s1",
              accountEmail: "assistant@example.com",
              accessRole: "owner",
              primary: false,
            },
            {
              sourceKey: "s2",
              accountEmail: "work@example.com",
              accessRole: "owner",
              primary: true,
            },
          ],
        },
      ],
      errors: [],
    });
    getUserSettingMock.mockResolvedValue({
      "work@example.com": "Work meetings",
      "assistant@example.com": "Assistant inbox",
    });

    const result = await action.run({});

    expect(result.calendars).toEqual([
      expect.objectContaining({ accountDescription: "Work meetings" }),
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
