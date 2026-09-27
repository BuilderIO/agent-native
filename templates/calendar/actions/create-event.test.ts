import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEventMock,
  getAuthStatusMock,
  isConnectedMock,
  prepareZoomMeetingPatchMock,
} = vi.hoisted(() => ({
  createEventMock: vi.fn(),
  getAuthStatusMock: vi.fn(),
  isConnectedMock: vi.fn(),
  prepareZoomMeetingPatchMock: vi.fn(),
}));

vi.mock("@agent-native/core/event-bus", () => ({
  emit: vi.fn(),
  registerEvent: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({ params }: { params?: Record<string, unknown> }) =>
      `https://calendar.example.test/event?date=${String(params?.date ?? "")}`,
  ),
  getRequestOrgId: vi.fn(() => undefined),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/event-video-conferencing.js", () => ({
  prepareZoomMeetingPatch: prepareZoomMeetingPatchMock,
  shouldAutoAddGoogleMeet: vi.fn(() => false),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  createEvent: createEventMock,
  getAuthStatus: getAuthStatusMock,
  isConnected: isConnectedMock,
}));

import { buildDeepLink } from "@agent-native/core/server";

import createEventAction from "./create-event";

describe("create-event recurrence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [] });
    createEventMock.mockResolvedValue({ id: "event-123" });
  });

  it("returns a caller-readable error for a blank event title", async () => {
    await expect(
      createEventAction.run({
        title: "   ",
        start: "2026-08-17T16:00:00.000Z",
        end: "2026-08-17T16:30:00.000Z",
      }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 400,
      message: "Event title is required.",
    });
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("passes normalized recurrence rules to Google Calendar on create", async () => {
    await createEventAction.run({
      title: "Daily standup",
      start: "2026-08-17T16:00:00.000Z",
      end: "2026-08-17T16:30:00.000Z",
      recurrence: "  RRULE:FREQ=DAILY  \n",
    });

    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: ["RRULE:FREQ=DAILY"],
      }),
      expect.objectContaining({
        account: {
          ownerEmail: "owner@example.com",
          accountEmail: "owner@example.com",
        },
      }),
    );
  });

  it("returns a record change with event-local timing and a Calendar deep link", async () => {
    const result = await createEventAction.run({
      title: "Late planning",
      start: "2026-10-03T06:30:00.000Z",
      end: "2026-10-03T06:50:00.000Z",
      startTimeZone: "America/Los_Angeles",
      location: "Conference room",
    });

    expect(result).toMatchObject({
      id: "google-event-123",
      title: "Late planning",
      change: {
        verb: "created",
        kind: "calendar-event",
        title: "Late planning",
        detail: "2026-10-02 23:30–23:50 America/Los_Angeles · Conference room",
        url: "https://calendar.example.test/event?date=2026-10-02",
      },
    });
    expect(buildDeepLink).toHaveBeenCalledWith({
      app: "calendar",
      view: "calendar",
      params: { eventId: "google-event-123", date: "2026-10-02" },
    });
  });

  it("uses the exclusive end date for an all-day working location", async () => {
    const result = await createEventAction.run({
      eventType: "workingLocation",
      workingLocationType: "homeOffice",
      allDay: true,
      start: "2026-10-31",
      end: "2026-11-03",
    });

    expect(result.change).toMatchObject({
      verb: "created",
      kind: "calendar-event",
      title: "Home",
      detail: "2026-10-31–2026-11-02",
      url: "https://calendar.example.test/event?date=2026-10-31",
    });
  });

  it("persists the event when Zoom provisioning fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    prepareZoomMeetingPatchMock.mockRejectedValue(new Error("Zoom 401"));

    try {
      const result = await createEventAction.run({
        title: "Customer call",
        start: "2026-08-17T16:00:00.000Z",
        end: "2026-08-17T16:30:00.000Z",
        addZoom: true,
      });

      expect(createEventMock).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: "google-event-123",
        title: "Customer call",
        videoConferenceError: "zoom",
      });
      expect(result.meetingLink).toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });
});
