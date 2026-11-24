import { beforeEach, describe, expect, it, vi } from "vitest";

const calendarMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getEvent: vi.fn(),
  resolveAccess: vi.fn(),
  readAppSecret: vi.fn(),
  refreshAccessTokenWithFallback: vi.fn(),
  resolveGoogleOAuthCredentialCandidates: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: calendarMocks.readAppSecret,
  writeAppSecret: calendarMocks.writeAppSecret,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: calendarMocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  isNull: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: calendarMocks.getDb,
  schema: {
    calendarAccounts: {
      id: "id",
      ownerEmail: "ownerEmail",
      status: "status",
    },
  },
}));

vi.mock("./google-calendar-client.js", () => ({
  detectPlatform: vi.fn(),
  getEvent: calendarMocks.getEvent,
  isPermanentRefreshFailure: (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    const lower = message.toLowerCase();
    return (
      lower.includes("invalid_grant") ||
      lower.includes("unauthorized_client") ||
      lower.includes("invalid_client")
    );
  },
  pickJoinUrl: vi.fn(),
  refreshAccessTokenWithFallback: calendarMocks.refreshAccessTokenWithFallback,
  resolveGoogleOAuthCredentialCandidates:
    calendarMocks.resolveGoogleOAuthCredentialCandidates,
}));

vi.mock("./recordings.js", () => ({
  getActiveOrganizationId: vi.fn(),
  getCurrentOwnerEmail: vi.fn(),
  getDefaultRecordingVisibility: vi.fn(),
  nanoid: vi.fn(),
}));

import {
  isDeclinedCalendarEvent,
  type CalendarAccountForEventClassification,
  isPersonalSoloCalendarEvent,
  isSoloCalendarEvent,
} from "./calendar-event-classification";
import {
  encodeCalendarMeetingId,
  fetchLiveCalendarEventFromId,
  parseCalendarMeetingId,
  recordCalendarFetchError,
  recordCalendarFetchSuccess,
  resolveCalendarAccessToken,
  shouldMarkNeedsReauth,
} from "./calendar-event-meetings";
import type { CalendarEvent } from "./google-calendar-client";

const account: CalendarAccountForEventClassification = {
  email: "user@example.com",
  ownerEmail: "user@example.com",
};

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event_1",
    summary: "Standup",
    start: { dateTime: "2026-07-09T16:00:00.000Z" },
    end: { dateTime: "2026-07-09T16:30:00.000Z" },
    ...overrides,
  };
}

describe("calendar personal solo event detection", () => {
  it("flags obvious personal blocks with no attendees", () => {
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Gym", attendees: [] }),
      }),
    ).toBe(true);
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Dinner", attendees: undefined }),
      }),
    ).toBe(true);
  });

  it("flags personal blocks that only include the calendar owner", () => {
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({
          summary: "Lunch",
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("keeps events with active attendees or less obvious titles", () => {
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({
          summary: "Dinner",
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
            { email: "teammate@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(false);
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Dinner with Bob", attendees: [] }),
      }),
    ).toBe(false);
    expect(
      isPersonalSoloCalendarEvent({
        account,
        event: event({ summary: "Product review", attendees: [] }),
      }),
    ).toBe(false);
  });
});

describe("calendar solo event detection", () => {
  it("flags any event with no attendees besides the calendar owner", () => {
    expect(
      isSoloCalendarEvent({
        account,
        event: event({ summary: "Steve im Seattle", attendees: [] }),
      }),
    ).toBe(true);
    expect(
      isSoloCalendarEvent({
        account,
        event: event({
          summary: "Steve im Seattle",
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("keeps events with an active attendee or external organizer", () => {
    expect(
      isSoloCalendarEvent({
        account,
        event: event({
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
            { email: "teammate@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(false);
    expect(
      isSoloCalendarEvent({
        account,
        event: event({
          attendees: [],
          organizer: { email: "teammate@example.com" },
        }),
      }),
    ).toBe(false);
  });
});

describe("calendar reconnect classification", () => {
  it("keeps transient token refresh failures connected", () => {
    expect(
      shouldMarkNeedsReauth(
        "Google token refresh failed (503): backend unavailable",
      ),
    ).toBe(false);
    expect(
      shouldMarkNeedsReauth("Google token refresh failed (429): rate limited"),
    ).toBe(false);
  });

  it("requires reconnect for confirmed authorization failures", () => {
    expect(shouldMarkNeedsReauth("invalid_grant: token revoked")).toBe(true);
    expect(
      shouldMarkNeedsReauth("Google Calendar list failed (401): nope"),
    ).toBe(true);
    expect(
      shouldMarkNeedsReauth("Google Calendar event failed (401): nope"),
    ).toBe(true);
  });
});

describe("calendar fetch status recording", () => {
  const calendarAccount = {
    id: "calendar_1",
    provider: "google",
    ownerEmail: "user@example.com",
  };

  function mockAccountUpdate() {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn((_values: Record<string, unknown>) => ({ where }));
    calendarMocks.getDb.mockReturnValue({
      update: vi.fn(() => ({ set })),
    });
    return { set, where };
  }

  it("does not promote a soft failure to connected", async () => {
    const { set } = mockAccountUpdate();

    const result = await recordCalendarFetchError(
      calendarAccount,
      new Error("Calendar unavailable"),
      { needsReauth: false },
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncError: "Calendar unavailable" }),
    );
    expect(set.mock.calls[0][0]).not.toHaveProperty("status");
    expect(result.needsReauth).toBe(false);
  });

  it("persists and returns an explicit reauthentication decision", async () => {
    const { set } = mockAccountUpdate();

    const result = await recordCalendarFetchError(
      calendarAccount,
      new Error("Token refresh failed"),
      { needsReauth: true },
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs-reauth",
        lastSyncError: "Google Calendar needs to be reconnected.",
      }),
    );
    expect(result).toEqual({
      accountId: "calendar_1",
      error: "Token refresh failed",
      needsReauth: true,
    });
  });

  it("records success only while the account remains connected", async () => {
    const { set, where } = mockAccountUpdate();

    await recordCalendarFetchSuccess(calendarAccount);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncError: null }),
    );
    expect(set.mock.calls[0][0]).not.toHaveProperty("status");
    expect(where).toHaveBeenCalledWith({
      kind: "and",
      conditions: [
        { kind: "eq", column: "id", value: "calendar_1" },
        { kind: "eq", column: "ownerEmail", value: "user@example.com" },
        { kind: "eq", column: "status", value: "connected" },
      ],
    });
  });
});

describe("calendar access token refresh", () => {
  const calendarAccount = {
    id: "calendar_1",
    provider: "google",
    ownerEmail: "user@example.com",
    accessTokenSecretRef: "calendar-access-token",
    refreshTokenSecretRef: "calendar-refresh-token",
  };

  beforeEach(() => {
    calendarMocks.readAppSecret.mockReset();
    calendarMocks.refreshAccessTokenWithFallback.mockReset();
    calendarMocks.resolveGoogleOAuthCredentialCandidates.mockReset();
    calendarMocks.writeAppSecret.mockReset();
    calendarMocks.resolveGoogleOAuthCredentialCandidates.mockResolvedValue([
      { clientId: "client-id", clientSecret: "client-secret" },
    ]);
  });

  function mockStoredTokens(expiresAt: number) {
    calendarMocks.readAppSecret
      .mockResolvedValueOnce({
        value: JSON.stringify({
          accessToken: "existing-access-token",
          expiresAt,
        }),
      })
      .mockResolvedValueOnce({ value: "refresh-token" });
  }

  it("reuses an access token above the request safety margin when refresh fails transiently", async () => {
    mockStoredTokens(Date.now() + 2 * 60_000);
    calendarMocks.refreshAccessTokenWithFallback.mockRejectedValue(
      new Error("Google token refresh failed (503): backend unavailable"),
    );

    await expect(resolveCalendarAccessToken(calendarAccount)).resolves.toBe(
      "existing-access-token",
    );
  });

  it("throws a transient refresh failure when the access token is expired", async () => {
    mockStoredTokens(Date.now() - 1);
    const error = new Error("Google token refresh failed (429): rate limited");
    calendarMocks.refreshAccessTokenWithFallback.mockRejectedValue(error);

    await expect(resolveCalendarAccessToken(calendarAccount)).rejects.toBe(
      error,
    );
  });

  it("throws a transient refresh failure inside the request safety margin", async () => {
    mockStoredTokens(Date.now() + 30_000);
    const error = new Error("Google token refresh failed (503): unavailable");
    calendarMocks.refreshAccessTokenWithFallback.mockRejectedValue(error);

    await expect(resolveCalendarAccessToken(calendarAccount)).rejects.toBe(
      error,
    );
  });

  it("returns null for a permanent refresh failure", async () => {
    mockStoredTokens(Date.now() + 2 * 60_000);
    calendarMocks.refreshAccessTokenWithFallback.mockRejectedValue(
      new Error("Google token refresh failed (400): invalid_grant"),
    );

    await expect(
      resolveCalendarAccessToken(calendarAccount),
    ).resolves.toBeNull();
  });
});

describe("calendar declined event detection", () => {
  it("flags an event declined by the current user even when others accepted", () => {
    expect(
      isDeclinedCalendarEvent({
        account,
        event: event({
          attendees: [
            { email: "user@example.com", responseStatus: "declined" },
            { email: "teammate@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("does not flag an event declined by another attendee", () => {
    expect(
      isDeclinedCalendarEvent({
        account,
        event: event({
          attendees: [
            { email: "user@example.com", responseStatus: "accepted" },
            { email: "teammate@example.com", responseStatus: "declined" },
          ],
        }),
      }),
    ).toBe(false);
  });

  it("trusts Google's self marker when the attendee email is omitted", () => {
    expect(
      isDeclinedCalendarEvent({
        account,
        event: event({
          attendees: [{ responseStatus: "declined", self: true }],
        }),
      }),
    ).toBe(true);
  });
});

describe("calendar meeting ids", () => {
  const TEAM = "team@group.calendar.google.com";

  it("keeps a main-calendar event's id in its original form", () => {
    const id = encodeCalendarMeetingId("acct-1", "weekly_20261117T150000Z");

    expect(id).toBe(
      `gcal_acct-1_${Buffer.from("weekly_20261117T150000Z").toString("base64url")}`,
    );
    expect(parseCalendarMeetingId(id)).toEqual({
      accountId: "acct-1",
      externalId: "weekly_20261117T150000Z",
      calendarId: "primary",
    });
  });

  it("carries another calendar's id through the meeting id", () => {
    const id = encodeCalendarMeetingId("acct-1", "planning", TEAM);

    expect(parseCalendarMeetingId(id)).toEqual({
      accountId: "acct-1",
      externalId: "planning",
      calendarId: TEAM,
    });
  });
});

describe("opening a live calendar event", () => {
  const TEAM = "team@group.calendar.google.com";

  function mockAccount(enabledCalendarIdsJson: string | null) {
    const row = {
      id: "acct-1",
      provider: "google",
      ownerEmail: "user@example.com",
      accessTokenSecretRef: "access-ref",
      enabledCalendarIdsJson,
    };
    calendarMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [row] }) }),
      }),
    });
  }

  beforeEach(() => {
    calendarMocks.getEvent.mockReset();
    calendarMocks.resolveAccess.mockResolvedValue({ role: "owner" });
    calendarMocks.resolveGoogleOAuthCredentialCandidates.mockResolvedValue([
      { clientId: "client", clientSecret: "secret" },
    ]);
    calendarMocks.readAppSecret.mockResolvedValue({
      value: JSON.stringify({ accessToken: "token" }),
    });
  });

  it("reads the event from the calendar it came from", async () => {
    mockAccount(JSON.stringify(["primary", TEAM]));
    calendarMocks.getEvent.mockResolvedValue(event({ id: "planning" }));

    const live = await fetchLiveCalendarEventFromId(
      encodeCalendarMeetingId("acct-1", "planning", TEAM),
    );

    expect(calendarMocks.getEvent).toHaveBeenCalledWith({
      accessToken: "token",
      calendarId: TEAM,
      eventId: "planning",
    });
    expect(live?.calendarId).toBe(TEAM);
  });

  it("won't read a calendar that isn't on", async () => {
    mockAccount(null);

    await expect(
      fetchLiveCalendarEventFromId(
        encodeCalendarMeetingId("acct-1", "planning", TEAM),
      ),
    ).resolves.toBeNull();
    expect(calendarMocks.getEvent).not.toHaveBeenCalled();
  });
});
