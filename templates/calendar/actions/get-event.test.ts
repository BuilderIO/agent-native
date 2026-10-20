import { beforeEach, describe, expect, it, vi } from "vitest";

const getEventMock = vi.hoisted(() => vi.fn());
const getClientsMock = vi.hoisted(() => vi.fn());
const getClientsWithErrorsMock = vi.hoisted(() => vi.fn());
const calendarGetEventMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/home"),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("../server/lib/google-api.js", () => ({
  calendarGetEvent: calendarGetEventMock,
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  getClients: getClientsMock,
  getClientsWithErrors: getClientsWithErrorsMock,
  getEvent: getEventMock,
}));

import {
  createGoogleAccountEventId,
  createGoogleCalendarSourceKey,
} from "../shared/google-calendar-sources";
import action from "./get-event";

describe("get-event shared calendar reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEventMock.mockResolvedValue({ id: "google-shared-event" });
    getClientsWithErrorsMock.mockResolvedValue({ clients: [], errors: [] });
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

  it("unwraps a selected primary event bound to its source account", async () => {
    const calendarSourceKey = createGoogleCalendarSourceKey({
      accountEmail: "connected@example.com",
      calendarId: "connected@example.com",
    });
    const id = createGoogleAccountEventId({
      accountEmail: "connected@example.com",
      googleEventId: "shared-event",
    });

    const result = await action.run({ id, calendarSourceKey }, {});

    expect(getEventMock).toHaveBeenCalledWith(
      "shared-event",
      {
        ownerEmail: "owner@example.com",
        accountEmail: "connected@example.com",
      },
      { calendarSourceKey },
    );
    expect(result).toMatchObject({ id });
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

  it("routes a multi-account event identity to its encoded account", async () => {
    getClientsWithErrorsMock.mockResolvedValue({
      clients: [
        { email: "alpha@example.com", accessToken: "alpha-token" },
        { email: "zulu@example.com", accessToken: "zulu-token" },
      ],
      errors: [],
    });
    calendarGetEventMock.mockResolvedValue({
      id: "same-provider-id",
      summary: "Z account event",
      start: { dateTime: "2026-07-06T16:00:00Z" },
      end: { dateTime: "2026-07-06T16:30:00Z" },
    });
    const id = createGoogleAccountEventId({
      accountEmail: "zulu@example.com",
      googleEventId: "same-provider-id",
    });

    const result = await action.run({ id, calendarId: "primary" }, {});

    expect(calendarGetEventMock).toHaveBeenCalledTimes(1);
    expect(calendarGetEventMock).toHaveBeenCalledWith(
      "zulu-token",
      "primary",
      "same-provider-id",
    );
    expect(result).toMatchObject({
      id,
      accountEmail: "zulu@example.com",
    });
  });

  it("preserves a provider failure for an account-scoped lookup", async () => {
    getClientsWithErrorsMock.mockResolvedValue({
      clients: [{ email: "zulu@example.com", accessToken: "zulu-token" }],
      errors: [],
    });
    calendarGetEventMock.mockRejectedValue(
      new Error("Google rate limited the request"),
    );
    const id = createGoogleAccountEventId({
      accountEmail: "zulu@example.com",
      googleEventId: "event-id",
    });

    await expect(action.run({ id, calendarId: "primary" }, {})).rejects.toThrow(
      "Google rate limited the request",
    );
  });

  it("preserves a token refresh failure for an account-scoped lookup", async () => {
    getClientsWithErrorsMock.mockResolvedValue({
      clients: [{ email: "alpha@example.com", accessToken: "alpha-token" }],
      errors: [{ email: "zulu@example.com", error: "Refresh token revoked" }],
    });
    const id = createGoogleAccountEventId({
      accountEmail: "zulu@example.com",
      googleEventId: "event-id",
    });

    await expect(action.run({ id, calendarId: "primary" }, {})).rejects.toThrow(
      "Refresh token revoked",
    );
    expect(calendarGetEventMock).not.toHaveBeenCalled();
  });
});
