import { beforeEach, describe, expect, it, vi } from "vitest";

const isConnectedMock = vi.hoisted(() => vi.fn());
const getEventMock = vi.hoisted(() => vi.fn());
const deleteEventMock = vi.hoisted(() => vi.fn());
const removeEventFromCalendarMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getEvent: getEventMock,
  deleteEvent: deleteEventMock,
  removeEventFromCalendar: removeEventFromCalendarMock,
}));

vi.mock("../server/lib/event-guest-notifications.js", () => ({
  normalizeGuestNotificationMessage: vi.fn((message) => message),
  sendEventGuestNotificationNote: vi.fn(),
}));

import action from "./delete-event";

describe("delete-event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
    deleteEventMock.mockResolvedValue(undefined);
    removeEventFromCalendarMock.mockResolvedValue(undefined);
  });

  it("returns a terminal already-absent result for a Google 404", async () => {
    deleteEventMock.mockRejectedValue(
      new Error("Google API error (404): Not Found"),
    );

    await expect(
      action.run({ id: "google-gone", scope: "single" }),
    ).resolves.toEqual({
      success: true,
      alreadyAbsent: true,
      id: "google-gone",
      accountEmail: "owner@example.com",
      scope: "single",
      removedOnly: false,
    });
  });
});
