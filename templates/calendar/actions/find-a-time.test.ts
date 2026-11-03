import { beforeEach, describe, expect, it, vi } from "vitest";

const listCalendarEventsMock = vi.hoisted(() => vi.fn());
const getFreeBusyMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ to }: { to: string }) => `calendar:${to}`,
  getRequestTimezone: () => "UTC",
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn().mockResolvedValue(null),
  readSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock("./list-events.js", () => ({
  listCalendarEvents: listCalendarEventsMock,
}));

vi.mock("./action-chat-ui.js", () => ({
  calendarTimeChoiceChange: () => null,
  resolveCalendarActionLocale: async () => "en-US",
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: async () => true,
  getConnectedAccounts: async () => [
    "primary@example.com",
    "secondary@example.com",
  ],
  getFreeBusy: getFreeBusyMock,
}));

import action from "./find-a-time";

describe("find-a-time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFreeBusyMock.mockResolvedValue({ calendars: {}, errors: [] });
  });

  it("shows events from a secondary connected account as the organizer's busy time", async () => {
    listCalendarEventsMock.mockResolvedValue({
      events: [
        {
          id: "evt-1",
          title: "Secondary meeting",
          start: "2026-09-08T10:00:00.000Z",
          end: "2026-09-08T11:00:00.000Z",
          allDay: false,
          source: "google",
          accountEmail: "secondary@example.com",
        },
      ],
      errors: [],
    });

    const result = (await action.run(
      { date: "2026-09-08", attendees: [], timezone: "UTC" } as never,
      undefined as never,
    )) as { busy: Array<{ participantEmail: string; title?: string }> };

    expect(result.busy).toEqual([
      expect.objectContaining({
        participantEmail: "primary@example.com",
        title: "Secondary meeting",
      }),
    ]);
  });
});
