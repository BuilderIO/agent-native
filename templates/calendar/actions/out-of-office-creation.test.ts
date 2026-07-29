import { runWithRequestContext } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isConnectedMock = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const createGoogleEventMock = vi.hoisted(() => vi.fn());
const writeAppStateMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(),
  writeAppState: writeAppStateMock,
  deleteAppState: vi.fn(),
  deleteAppStateByPrefix: vi.fn(),
}));

vi.mock("@agent-native/core/event-bus", () => ({ emit: vi.fn() }));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: getAuthStatusMock,
  createEvent: createGoogleEventMock,
}));

vi.mock("../server/lib/event-video-conferencing.js", () => ({
  prepareZoomMeetingPatch: vi.fn(),
  shouldAutoAddGoogleMeet: vi.fn(() => false),
}));

import createEventAction from "./create-event";
import manageEventDraftAction from "./manage-event-draft";

describe("out-of-office action parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({
      accounts: [{ email: "owner@example.com" }],
    });
    createGoogleEventMock.mockResolvedValue({ id: "ooo-1" });
  });

  it("creates an inclusive full-day OOO through the shared action boundary", async () => {
    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      createEventAction.run({
        eventType: "outOfOffice",
        start: "2026-10-31",
        end: "2026-11-01",
        startTimeZone: "America/New_York",
        fullDay: true,
        accountEmail: "owner@example.com",
      }),
    );

    expect(createGoogleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Out of office",
        start: "2026-10-31T04:00:00.000Z",
        end: "2026-11-02T05:00:00.000Z",
        startTimeZone: "America/New_York",
        endTimeZone: "America/New_York",
        allDay: false,
        accountEmail: "owner@example.com",
        eventType: "outOfOffice",
        outOfOfficeProperties: {
          autoDeclineMode: "declineAllConflictingInvitations",
          declineMessage: "Declined because I am out of office",
        },
      }),
      expect.objectContaining({
        account: {
          ownerEmail: "owner@example.com",
          accountEmail: "owner@example.com",
        },
      }),
    );
  });

  it("persists the same inclusive dates and defaults in an agent-created draft", async () => {
    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      manageEventDraftAction.run({
        id: "ooo-draft",
        eventType: "outOfOffice",
        start: "2026-10-31",
        end: "2026-11-01",
        startTimeZone: "America/New_York",
        fullDay: true,
        accountEmail: "owner@example.com",
      }),
    );

    expect(writeAppStateMock).toHaveBeenCalledWith(
      "calendar-draft-ooo-draft",
      expect.objectContaining({
        id: "ooo-draft",
        title: "Out of office",
        start: "2026-10-31",
        end: "2026-11-01",
        startTimeZone: "America/New_York",
        fullDay: true,
        allDay: false,
        eventType: "outOfOffice",
        outOfOfficeProperties: {
          autoDeclineMode: "declineAllConflictingInvitations",
          declineMessage: "Declined because I am out of office",
        },
      }),
    );
  });
});
