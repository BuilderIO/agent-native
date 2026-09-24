import { beforeEach, describe, expect, it, vi } from "vitest";

const getEventMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/home"),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/google-api.js", () => ({
  calendarGetEvent: vi.fn(),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  getClients: vi.fn(),
  getEvent: getEventMock,
}));

import { createGoogleCalendarSourceKey } from "../shared/google-calendar-sources";
import action from "./get-event";

describe("get-event shared calendar reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEventMock.mockResolvedValue({ id: "google-shared-event" });
  });

  it("passes an opaque source through the owner-scoped read path", async () => {
    const calendarSourceKey = createGoogleCalendarSourceKey({
      accountEmail: "connected@example.com",
      calendarId: "shared@example.com",
    });

    await action.run(
      {
        id: `google-${calendarSourceKey}-shared-event`,
        calendarId: "primary",
        calendarSourceKey,
      },
      {},
    );

    expect(getEventMock).toHaveBeenCalledWith(
      "shared-event",
      {
        ownerEmail: "owner@example.com",
        accountEmail: "connected@example.com",
      },
      { calendarSourceKey },
    );
  });

  it("rejects the legacy raw non-primary calendarId bypass", async () => {
    await expect(
      action.run(
        {
          id: "google-shared-event",
          calendarId: "shared@example.com",
        },
        {},
      ),
    ).rejects.toThrow("require a validated calendarSourceKey");
  });
});
