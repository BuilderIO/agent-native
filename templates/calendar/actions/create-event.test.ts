import { beforeEach, describe, expect, it, vi } from "vitest";

const { createEventMock, getAuthStatusMock, isConnectedMock } = vi.hoisted(
  () => ({
    createEventMock: vi.fn(),
    getAuthStatusMock: vi.fn(),
    isConnectedMock: vi.fn(),
  }),
);

vi.mock("@agent-native/core/event-bus", () => ({
  emit: vi.fn(),
  registerEvent: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "https://calendar.example.test/event"),
  getRequestOrgId: vi.fn(() => undefined),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/event-video-conferencing.js", () => ({
  prepareZoomMeetingPatch: vi.fn(),
  shouldAutoAddGoogleMeet: vi.fn(() => false),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  createEvent: createEventMock,
  getAuthStatus: getAuthStatusMock,
  isConnected: isConnectedMock,
}));

import createEventAction from "./create-event";

describe("create-event recurrence", () => {
  beforeEach(() => {
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [] });
    createEventMock.mockResolvedValue({ id: "event-123" });
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
});
