import { runWithRequestContext } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isConnectedMock = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const getEventMock = vi.hoisted(() => vi.fn());
const updateEventMock = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: getAuthStatusMock,
  getEvent: getEventMock,
  updateEvent: updateEventMock,
}));

vi.mock("../server/lib/event-guest-notifications.js", () => ({
  normalizeGuestNotificationMessage: vi.fn((message) => message),
  sendEventGuestNotificationNote: vi.fn(),
}));

vi.mock("../server/lib/event-video-conferencing.js", () => ({
  prepareZoomMeetingPatch: vi.fn(),
}));

import action from "./update-event";

describe("update-event working locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [] });
    updateEventMock.mockResolvedValue({
      htmlLink: "https://calendar.google.com/event",
    });
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

  it("updates one recurring instance by its instance id and clears office labels for Home", async () => {
    getEventMock.mockResolvedValue({
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
    });

    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      action.run({
        id: "google-instance-20260707",
        workingLocationType: "homeOffice",
        workingLocationLabel: "",
        location: "",
        scope: "single",
      }),
    );

    expect(updateEventMock).toHaveBeenCalledWith(
      "instance-20260707",
      expect.objectContaining({
        workingLocationProperties: {
          type: "homeOffice",
          homeOffice: {},
        },
      }),
      expect.objectContaining({ scope: "single" }),
    );
    expect(updateEventMock.mock.calls[0]?.[1]).not.toHaveProperty("location");
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
