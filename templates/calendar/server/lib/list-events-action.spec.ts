import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const isConnectedMock = vi.hoisted(() => vi.fn());
const getOwnedAccountEmailsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({})),
}));
vi.mock("./google-calendar.js", () => ({
  getOwnedAccountEmails: getOwnedAccountEmailsMock,
  isConnected: isConnectedMock,
}));
vi.mock("./ical-fetcher.js", () => ({
  fetchICalEvents: vi.fn(),
}));
vi.mock("../db/index.js", () => ({
  schema: {
    bookingLinks: { slug: {}, title: {}, color: {} },
    bookingLinkShares: {},
  },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  }),
}));

import {
  listCalendarEvents,
  resolveCalendarEventRange,
} from "../../actions/list-events";

describe("calendar event ranges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    getUserSettingMock
      .mockResolvedValueOnce({ timezone: "Europe/Warsaw" })
      .mockResolvedValue([]);
    isConnectedMock.mockResolvedValue(false);
    getOwnedAccountEmailsMock.mockResolvedValue([]);
  });

  it("uses Calendar settings for date-only list ranges", async () => {
    const result = await listCalendarEvents({
      from: "2026-07-23",
      to: "2026-07-24",
    });

    expect(result.range).toMatchObject({
      from: "2026-07-22T22:00:00.000Z",
      to: "2026-07-23T22:00:00.000Z",
      timezone: "Europe/Warsaw",
    });
  });

  it("handles a 23-hour spring-forward calendar day", () => {
    expect(
      resolveCalendarEventRange({
        from: "2026-03-08",
        to: "2026-03-09",
        timezone: "America/New_York",
      }),
    ).toMatchObject({
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T04:00:00.000Z",
    });
  });
});
