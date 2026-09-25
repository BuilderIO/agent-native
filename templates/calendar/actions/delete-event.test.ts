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

import { createGoogleAccountEventId } from "../shared/google-calendar-sources";
import action from "./delete-event";

describe("delete-event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [] });
    deleteEventMock.mockResolvedValue(undefined);
    removeEventFromCalendarMock.mockResolvedValue(undefined);
  });

  it.each([404, 410])(
    "returns a terminal already-absent result for a Google %s",
    async (status) => {
      deleteEventMock.mockRejectedValue(
        new Error(`Google API error (${status}): Gone`),
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
    },
  );

  it("treats a removed calendar copy as already absent", async () => {
    removeEventFromCalendarMock.mockRejectedValue(
      new Error("Google API error (410): Resource has been deleted"),
    );

    await expect(
      action.run({
        id: "google-gone",
        accountEmail: "owner@example.com",
        removeOnly: true,
      }),
    ).resolves.toEqual({
      success: true,
      alreadyAbsent: true,
      id: "google-gone",
      accountEmail: "owner@example.com",
      scope: "single",
      removedOnly: true,
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

  it("rejects overlaid-calendar events before any mutation", async () => {
    await expect(
      action.run({
        id: "overlay-person@example.com-overlay-event",
        scope: "single",
      }),
    ).rejects.toThrow("Overlay Google calendar events are read-only");

    expect(deleteEventMock).not.toHaveBeenCalled();
    expect(removeEventFromCalendarMock).not.toHaveBeenCalled();
  });

  it("rejects an account that conflicts with the opaque event identity", async () => {
    getAuthStatusMock.mockResolvedValue({
      accounts: [{ email: "alpha@example.com" }, { email: "zulu@example.com" }],
    });
    const id = createGoogleAccountEventId({
      accountEmail: "alpha@example.com",
      googleEventId: "same-provider-id",
    });

    await expect(
      action.run({
        id,
        accountEmail: "zulu@example.com",
        scope: "single",
      }),
    ).rejects.toThrow("does not match");

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
