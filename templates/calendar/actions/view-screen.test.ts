import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const readCalendarSettingsMock = vi.hoisted(() => vi.fn());
const listCalendarEventsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: readAppStateMock,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));

vi.mock("../server/lib/calendar-settings.js", () => ({
  readCalendarSettings: readCalendarSettingsMock,
}));

vi.mock("../server/lib/booking-link-utils.js", () => ({
  rowToBookingLink: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: {
    bookingLinks: {},
    bookingLinkShares: {},
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
}));

vi.mock("./list-events.js", () => ({
  listCalendarEvents: listCalendarEventsMock,
}));

vi.mock("./event-action-helpers.js", () => ({
  extractVideoLink: vi.fn(),
}));

import viewScreen from "./view-screen.js";

describe("view-screen calendar context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    readCalendarSettingsMock.mockResolvedValue({
      timezone: "America/Los_Angeles",
      weekStart: "monday",
    });
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "calendar",
          calendarViewMode: "week",
          date: "2026-08-13",
        };
      }
      return null;
    });
    listCalendarEventsMock.mockResolvedValue({
      events: [
        {
          id: "google-instance",
          title: "121 with Gonzalo",
          start: "2026-09-02T13:30:00.000Z",
          end: "2026-09-02T14:00:00.000Z",
          source: "google",
          allDay: false,
          attendees: [],
          recurrence: undefined,
          recurringEventId: "google-series",
        },
      ],
      errors: [],
      googleConnected: true,
      range: {
        from: "2026-08-10T07:00:00.000Z",
        to: "2026-08-17T07:00:00.000Z",
        timezone: "America/Los_Angeles",
        defaulted: false,
      },
    });
  });

  it("matches the visible week and preserves recurring occurrence identity", async () => {
    const result = JSON.parse(await viewScreen.run({}));

    expect(listCalendarEventsMock).toHaveBeenCalledWith({
      from: "2026-08-10T07:00:00.000Z",
      to: "2026-08-17T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(result.events.items).toMatchObject([
      {
        id: "google-instance",
        recurringEventId: "google-series",
      },
    ]);
  });

  it("uses the visible day instead of always loading a week", async () => {
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "calendar",
          calendarViewMode: "day",
          date: "2026-08-13",
        };
      }
      return null;
    });

    await viewScreen.run({});

    expect(listCalendarEventsMock).toHaveBeenCalledWith({
      from: "2026-08-13T07:00:00.000Z",
      to: "2026-08-14T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
  });
});
