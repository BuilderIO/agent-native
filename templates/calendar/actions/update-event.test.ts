import { runWithRequestContext } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isConnectedMock = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const getEventMock = vi.hoisted(() => vi.fn());
const updateEventMock = vi.hoisted(() => vi.fn());
const createEventMock = vi.hoisted(() => vi.fn());
const deleteEventMock = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: getAuthStatusMock,
  getEvent: getEventMock,
  updateEvent: updateEventMock,
  createEvent: createEventMock,
  deleteEvent: deleteEventMock,
}));

vi.mock("../server/lib/event-guest-notifications.js", () => ({
  normalizeGuestNotificationMessage: vi.fn((message) => message),
  sendEventGuestNotificationNote: vi.fn(),
}));

vi.mock("../server/lib/event-video-conferencing.js", () => ({
  prepareZoomMeetingPatch: vi.fn(),
}));

import action from "./update-event";

function recurringWorkingLocationEvent() {
  return {
    id: "google-instance-20260707",
    recurringEventId: "working-location-series",
    title: "Office",
    description: "",
    location: "Pier 57",
    start: "2026-07-07",
    end: "2026-07-08",
    allDay: true,
    source: "google",
    accountEmail: "owner@example.com",
    eventType: "workingLocation",
    workingLocationProperties: {
      type: "officeLocation",
      officeLocation: { label: "Pier 57", buildingId: "nyc" },
    },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

describe("update-event working locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [] });
    updateEventMock.mockResolvedValue({
      htmlLink: "https://calendar.google.com/event",
    });
    createEventMock.mockResolvedValue({
      id: "working-location-override",
      htmlLink: "https://calendar.google.com/override",
    });
    deleteEventMock.mockResolvedValue(undefined);
  });

  it("patches working-location metadata on existing Google working-location events", async () => {
    getEventMock.mockResolvedValue({
      id: "google-working-location-1",
      title: "Working location",
      description: "",
      location: "",
      start: "2026-07-06",
      end: "2026-07-07",
      allDay: true,
      source: "google",
      accountEmail: "owner@example.com",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {
          label: "Old office",
          buildingId: "nyc",
          floorId: "6",
          floorSectionId: "east",
          deskId: "D14",
        },
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });

    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      action.run({
        id: "google-working-location-1",
        workingLocationType: "officeLocation",
        workingLocationLabel: "Pier 57",
        location: "Forbidden generic location",
      }),
    );

    expect(updateEventMock).toHaveBeenCalledWith(
      "working-location-1",
      expect.objectContaining({
        accountEmail: "owner@example.com",
        transparency: "transparent",
        visibility: "public",
        workingLocationProperties: {
          type: "officeLocation",
          officeLocation: {
            label: "Pier 57",
            buildingId: "nyc",
            floorId: "6",
            floorSectionId: "east",
            deskId: "D14",
          },
        },
      }),
      expect.any(Object),
    );
    expect(updateEventMock.mock.calls[0]?.[1]).not.toHaveProperty("location");
  });

  it("replaces one recurring working-location instance with a single-day override", async () => {
    getEventMock.mockResolvedValue(recurringWorkingLocationEvent());

    const result = await runWithRequestContext(
      { userEmail: "owner@example.com" },
      () =>
        action.run({
          id: "google-instance-20260707",
          workingLocationType: "homeOffice",
          workingLocationLabel: "",
          location: "",
          scope: "single",
        }),
    );

    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start: "2026-07-07",
        end: "2026-07-08",
        allDay: true,
        eventType: "workingLocation",
        workingLocationProperties: {
          type: "homeOffice",
          homeOffice: {},
        },
      }),
      {
        account: {
          ownerEmail: "owner@example.com",
          accountEmail: "owner@example.com",
        },
      },
    );
    expect(createEventMock.mock.calls[0]?.[0]).not.toHaveProperty("recurrence");
    expect(createEventMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "recurringEventId",
    );
    expect(deleteEventMock).toHaveBeenCalledWith(
      "instance-20260707",
      {
        ownerEmail: "owner@example.com",
        accountEmail: "owner@example.com",
      },
      { scope: "single" },
    );
    expect(updateEventMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "google-working-location-override",
      replacedId: "google-instance-20260707",
    });
  });

  it("sends time-only working-location edits as complete status events", async () => {
    getEventMock.mockResolvedValue(recurringWorkingLocationEvent());

    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      action.run({
        id: "google-instance-20260707",
        start: "2026-07-08",
        end: "2026-07-09",
        allDay: true,
        scope: "single",
      }),
    );

    expect(updateEventMock).toHaveBeenCalledWith(
      "instance-20260707",
      expect.objectContaining({
        eventType: "workingLocation",
        start: "2026-07-08",
        end: "2026-07-09",
        allDay: true,
        transparency: "transparent",
        visibility: "public",
        workingLocationProperties: {
          type: "officeLocation",
          officeLocation: { label: "Pier 57", buildingId: "nyc" },
        },
      }),
      expect.objectContaining({ scope: "single" }),
    );
    expect(createEventMock).not.toHaveBeenCalled();
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it("removes the replacement if cancelling the recurring instance fails", async () => {
    getEventMock.mockResolvedValue(recurringWorkingLocationEvent());
    const cancellationError = new Error("Google rejected cancellation");
    deleteEventMock
      .mockRejectedValueOnce(cancellationError)
      .mockResolvedValueOnce(undefined);

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        action.run({
          id: "google-instance-20260707",
          workingLocationType: "homeOffice",
          scope: "single",
        }),
      ),
    ).rejects.toThrow("Google rejected cancellation");

    expect(deleteEventMock).toHaveBeenNthCalledWith(
      2,
      "working-location-override",
      {
        ownerEmail: "owner@example.com",
        accountEmail: "owner@example.com",
      },
      { scope: "single" },
    );
  });

  it("does not cancel the original instance when Google omits the replacement id", async () => {
    getEventMock.mockResolvedValue(recurringWorkingLocationEvent());
    createEventMock.mockResolvedValue({});

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        action.run({
          id: "google-instance-20260707",
          workingLocationType: "homeOffice",
          scope: "single",
        }),
      ),
    ).rejects.toThrow("Google did not return an id");

    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it("rejects mixed edits for a single recurring working-location occurrence", async () => {
    getEventMock.mockResolvedValue(recurringWorkingLocationEvent());

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        action.run({
          id: "google-instance-20260707",
          workingLocationType: "homeOffice",
          colorId: "2",
          scope: "single",
        }),
      ),
    ).rejects.toThrow("Change the working location separately");

    expect(createEventMock).not.toHaveBeenCalled();
    expect(deleteEventMock).not.toHaveBeenCalled();
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it("drops incompatible office metadata when switching to a custom location", async () => {
    getEventMock.mockResolvedValue({
      id: "google-working-location-1",
      title: "Office",
      description: "",
      location: "Pier 57",
      start: "2026-07-07",
      end: "2026-07-08",
      allDay: true,
      source: "google",
      accountEmail: "owner@example.com",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {
          label: "Pier 57",
          buildingId: "nyc",
          deskId: "D14",
        },
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });

    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      action.run({
        id: "google-working-location-1",
        workingLocationType: "customLocation",
        workingLocationLabel: "Neighborhood cafe",
        location: "Neighborhood cafe",
      }),
    );

    expect(updateEventMock).toHaveBeenCalledWith(
      "working-location-1",
      expect.objectContaining({
        workingLocationProperties: {
          type: "customLocation",
          customLocation: { label: "Neighborhood cafe" },
        },
      }),
      expect.any(Object),
    );
    expect(updateEventMock.mock.calls[0]?.[1]).not.toHaveProperty("location");
  });

  it("rejects a generic location-only edit on an existing working-location event", async () => {
    getEventMock.mockResolvedValue({
      id: "google-working-location-1",
      title: "Home",
      description: "",
      location: "",
      start: "2026-07-07",
      end: "2026-07-08",
      allDay: true,
      source: "google",
      accountEmail: "owner@example.com",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "homeOffice",
        homeOffice: {},
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        action.run({
          id: "google-working-location-1",
          location: "Pier 57",
        }),
      ),
    ).rejects.toThrow(
      "Working-location events do not support a generic location. Use workingLocationType and workingLocationLabel instead.",
    );
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it("keeps generic location edits working for ordinary events", async () => {
    getEventMock.mockResolvedValue({
      id: "google-event-1",
      title: "Team meeting",
      description: "",
      location: "Old room",
      start: "2026-07-07T15:00:00.000Z",
      end: "2026-07-07T15:30:00.000Z",
      allDay: false,
      source: "google",
      accountEmail: "owner@example.com",
      eventType: "default",
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });

    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      action.run({
        id: "google-event-1",
        location: "Conference room B",
      }),
    );

    expect(updateEventMock).toHaveBeenCalledWith(
      "event-1",
      expect.objectContaining({ location: "Conference room B" }),
      expect.any(Object),
    );
  });

  it("does not try to convert a normal event into a working-location event", async () => {
    getEventMock.mockResolvedValue({
      id: "google-event-1",
      title: "Normal meeting",
      description: "",
      location: "",
      start: "2026-07-06T15:00:00.000Z",
      end: "2026-07-06T15:30:00.000Z",
      allDay: false,
      source: "google",
      accountEmail: "owner@example.com",
      eventType: "default",
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        action.run({
          id: "google-event-1",
          workingLocationType: "customLocation",
          workingLocationLabel: "Home",
        }),
      ),
    ).rejects.toThrow(
      "Working location details can only be updated on existing working-location events.",
    );
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it("rejects multi-day all-day updates for working-location events before patching Google", async () => {
    getEventMock.mockResolvedValue({
      id: "google-working-location-1",
      title: "Home",
      description: "",
      location: "",
      start: "2026-07-06",
      end: "2026-07-07",
      allDay: true,
      source: "google",
      accountEmail: "owner@example.com",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "homeOffice",
        homeOffice: {},
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });

    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        action.run({
          id: "google-working-location-1",
          end: "2026-07-11",
        }),
      ),
    ).rejects.toThrow("All-day working location events must be a single day.");
    expect(updateEventMock).not.toHaveBeenCalled();
  });
});
