import { beforeEach, describe, expect, it, vi } from "vitest";

const isConnectedMock = vi.hoisted(() => vi.fn());
const rsvpEventMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
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
});
