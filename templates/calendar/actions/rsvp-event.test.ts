import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildDeepLinkMock, isConnectedMock, rsvpEventMock } = vi.hoisted(
  () => ({
    buildDeepLinkMock: vi.fn(
      () => "/_agent-native/open?eventId=google-event-1",
    ),
    isConnectedMock: vi.fn(),
    rsvpEventMock: vi.fn(),
  }),
);

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: buildDeepLinkMock,
  getRequestOrgId: vi.fn(() => undefined),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: vi.fn(() => ({ accounts: [] })),
  rsvpEvent: rsvpEventMock,
}));

import action from "./rsvp-event";

describe("rsvp-event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnectedMock.mockResolvedValue(true);
  });

  it("rejects a shared source id before sending an RSVP to primary", async () => {
    await expect(
      action.run({
        id: "google-google-calendar:opaque-source-shared-event",
        status: "accepted",
      }),
    ).rejects.toThrow("Shared Google calendar events are read-only");

    expect(rsvpEventMock).not.toHaveBeenCalled();
  });

  it("returns a compact RSVP card linked to the updated event", async () => {
    const result = await action.run({
      id: "google-event-1",
      status: "accepted",
      note: "Sensitive response note",
    });

    expect(result.change).toEqual({
      verb: "updated",
      kind: "calendar-event",
      title: "RSVP",
      detail: "accepted",
      url: "/_agent-native/open?eventId=google-event-1",
    });
    expect(JSON.stringify(result.change)).not.toContain(
      "Sensitive response note",
    );
    expect(buildDeepLinkMock).toHaveBeenCalledWith({
      app: "calendar",
      view: "calendar",
      params: { eventId: "google-event-1" },
    });
  });
});
