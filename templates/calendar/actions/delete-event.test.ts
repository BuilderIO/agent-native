import { beforeEach, describe, expect, it, vi } from "vitest";

const isConnectedMock = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const getEventMock = vi.hoisted(() => vi.fn());
const deleteEventMock = vi.hoisted(() => vi.fn());
const removeEventFromCalendarMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(() => undefined),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: getAuthStatusMock,
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
    getAuthStatusMock.mockResolvedValue({ accounts: [] });
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

  it("rejects namespaced shared-calendar events before any mutation", async () => {
    await expect(
      action.run({
        id: "google-google-calendar:opaque-source-shared-event",
        scope: "single",
      }),
    ).rejects.toThrow("Shared Google calendar events are read-only");

    expect(deleteEventMock).not.toHaveBeenCalled();
    expect(removeEventFromCalendarMock).not.toHaveBeenCalled();
  });

  it("gates only a delete that reaches the guests", async () => {
    const gate = action.needsApproval;
    if (typeof gate !== "function") throw new Error("expected a predicate");

    expect(await gate({ id: "google-a" } as never)).toBe(false);
    expect(await gate({ id: "google-a", sendUpdates: "none" } as never)).toBe(
      false,
    );
    expect(await gate({ id: "google-a", sendUpdates: "all" } as never)).toBe(
      true,
    );
    expect(
      await gate({ id: "google-a", notificationMessage: "Sorry!" } as never),
    ).toBe(true);
    // A blank note sends no companion email, so it is not a reason to stop.
    expect(
      await gate({ id: "google-a", notificationMessage: "   " } as never),
    ).toBe(false);
    // removeOnly forces sendUpdates to none, so no guest hears about it.
    expect(
      await gate({
        id: "google-a",
        sendUpdates: "all",
        removeOnly: "true",
      } as never),
    ).toBe(false);
  });
});
