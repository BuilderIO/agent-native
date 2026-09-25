import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calendarListEvents: vi.fn(),
  getClientsForAccountsWithErrors: vi.fn(),
  getJevContextCredentials: vi.fn(),
  getUserSetting: vi.fn(),
  isJevEnabled: vi.fn(),
  listOAuthAccounts: vi.fn(),
  mutateUserSetting: vi.fn(),
  registerRecurringSweepHandler: vi.fn(),
  requestJevThroughBuilder: vi.fn(),
  getEvent: vi.fn(),
  rsvpEvent: vi.fn(),
  runWithRequestContext: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccounts: mocks.listOAuthAccounts,
}));
vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  isJevEnabled: mocks.isJevEnabled,
  registerRecurringSweepHandler: mocks.registerRecurringSweepHandler,
  requestJevThroughBuilder: mocks.requestJevThroughBuilder,
  runWithRequestContext: mocks.runWithRequestContext,
  scheduledTriggerAvailability: () => ({ available: false }),
}));
vi.mock("@agent-native/core/server/interval-job", () => ({
  startIntervalJob: vi.fn(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
}));
vi.mock("../lib/google-api.js", () => ({
  GoogleApiError: class GoogleApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  calendarListEvents: mocks.calendarListEvents,
}));
vi.mock("../lib/google-calendar.js", () => ({
  getClientsForAccountsWithErrors: mocks.getClientsForAccountsWithErrors,
  getEvent: mocks.getEvent,
  rsvpEvent: mocks.rsvpEvent,
}));

import {
  isEligibleInvitation,
  runCalendarEventRulesOnce,
} from "./event-rules.js";

describe("calendar event rules sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOAuthAccounts.mockResolvedValue([]);
    mocks.runWithRequestContext.mockImplementation((_context, callback) =>
      callback(),
    );
  });

  it("only evaluates upcoming invitations needing the user's response", () => {
    const now = Date.parse("2026-09-25T12:00:00.000Z");
    const event = {
      end: { dateTime: "2026-09-25T13:00:00.000Z" },
      attendees: [{ email: "ME@example.com", responseStatus: "needsAction" }],
    };

    expect(isEligibleInvitation(event, "me@example.com", now)).toBe(true);
    expect(
      isEligibleInvitation(
        {
          ...event,
          attendees: [{ email: "me@example.com", responseStatus: "accepted" }],
        },
        "me@example.com",
        now,
      ),
    ).toBe(false);
    expect(
      isEligibleInvitation(
        { ...event, organizer: { self: true } },
        "me@example.com",
        now,
      ),
    ).toBe(false);
    expect(
      isEligibleInvitation(
        { ...event, end: { dateTime: "2026-09-25T11:59:59.000Z" } },
        "me@example.com",
        now,
      ),
    ).toBe(false);
  });

  it("keeps per-account progress and continues to later owners after failure", async () => {
    const settingsByOwner: Record<string, Record<string, any>> = {
      "first@example.com": {
        "calendar-settings": { eventRules: { hide: "Hide focus blocks" } },
      },
      "second@example.com": { "calendar-settings": { eventRules: {} } },
    };
    mocks.listOAuthAccounts.mockResolvedValue([
      { owner: "first@example.com" },
      { owner: "second@example.com" },
    ]);
    mocks.getJevContextCredentials.mockResolvedValue({ builderAuth: "auth" });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: { event_0_0: { noul: 1 } },
    });
    mocks.getUserSetting.mockImplementation(
      async (owner: string, key: string) => settingsByOwner[owner]?.[key],
    );
    mocks.mutateUserSetting.mockImplementation(
      async (owner: string, key: string, update: any) => {
        const current = settingsByOwner[owner]?.[key];
        const next = typeof update === "function" ? update(current) : update;
        settingsByOwner[owner] ??= {};
        settingsByOwner[owner][key] = structuredClone(next);
        return settingsByOwner[owner][key];
      },
    );
    mocks.getClientsForAccountsWithErrors.mockImplementation(
      async (owner: string) => ({
        clients:
          owner === "first@example.com"
            ? [
                { email: "one@example.com", accessToken: "one" },
                { email: "two@example.com", accessToken: "two" },
              ]
            : [],
        errors: [],
      }),
    );
    mocks.calendarListEvents.mockImplementation(async (token: string) => {
      if (token === "two") throw new Error("calendar unavailable");
      return {
        items: [
          {
            id: "event-1",
            created: new Date(Date.now() + 1_000).toISOString(),
            updated: "2026-09-25T12:00:00.000Z",
            status: "confirmed",
            end: { dateTime: new Date(Date.now() + 3_600_000).toISOString() },
            attendees: [
              { email: "one@example.com", responseStatus: "needsAction" },
            ],
          },
        ],
        nextSyncToken: "first-account-cursor",
      };
    });

    let failure: unknown;
    try {
      await runCalendarEventRulesOnce();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ name: "AggregateError" });
    expect(
      (failure as Error & { errors: Error[] }).errors.map(
        ({ message }) => message,
      ),
    ).toEqual(["first@example.com: calendar unavailable"]);
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "second@example.com",
      "calendar-settings",
    );
    expect(
      settingsByOwner["first@example.com"]["calendar-event-rules-runtime"],
    ).toMatchObject({
      cursors: { "one@example.com:primary": "first-account-cursor" },
      processed: {
        "google:one@example.com:primary:event-1":
          "2026-09-25T12:00:00.000Z:confirmed",
      },
      lastError: "calendar unavailable",
    });
  });

  it("processes healthy accounts and records each token refresh error", async () => {
    const owner = "owner@example.com";
    const settingsByOwner: Record<string, Record<string, any>> = {
      [owner]: {
        "calendar-settings": { eventRules: { hide: "Hide focus blocks" } },
      },
    };
    mocks.listOAuthAccounts.mockResolvedValue([{ owner }]);
    mocks.getUserSetting.mockImplementation(
      async (email: string, key: string) => settingsByOwner[email]?.[key],
    );
    mocks.mutateUserSetting.mockImplementation(
      async (email: string, key: string, update: any) => {
        const current = settingsByOwner[email]?.[key];
        const next = typeof update === "function" ? update(current) : update;
        settingsByOwner[email] ??= {};
        settingsByOwner[email][key] = structuredClone(next);
        return settingsByOwner[email][key];
      },
    );
    mocks.getClientsForAccountsWithErrors.mockResolvedValue({
      clients: [{ email: "healthy@example.com", accessToken: "healthy" }],
      errors: [
        { email: "first@example.com", error: "refresh denied" },
        { email: "second@example.com", error: "connection expired" },
      ],
    });
    mocks.calendarListEvents.mockResolvedValue({
      items: [],
      nextSyncToken: "healthy-account-cursor",
    });

    let failure: unknown;
    try {
      await runCalendarEventRulesOnce();
    } catch (error) {
      failure = error;
    }

    expect(mocks.calendarListEvents).toHaveBeenCalledWith(
      "healthy",
      "primary",
      expect.objectContaining({ showDeleted: true }),
    );
    expect(failure).toMatchObject({ name: "AggregateError" });
    const ownerFailure = (failure as Error & { errors: Error[] }).errors[0];
    expect(ownerFailure.message).toContain("2 account(s)");
    expect(
      settingsByOwner[owner]["calendar-event-rules-runtime"],
    ).toMatchObject({
      accountRefreshErrors: [
        { email: "first@example.com", error: "refresh denied" },
        { email: "second@example.com", error: "connection expired" },
      ],
      cursors: { "healthy@example.com:primary": "healthy-account-cursor" },
      lastError: expect.stringContaining("2 account(s)"),
    });
  });

  it("persists the first watermark before evaluation so a failure retries the same backlog", async () => {
    const accountKey = "one@example.com:primary";
    const settingsByOwner: Record<string, Record<string, any>> = {
      "owner@example.com": {
        "calendar-settings": { eventRules: { hide: "Hide focus blocks" } },
      },
    };
    const event = {
      id: "event-1",
      created: new Date(Date.now() + 60_000).toISOString(),
      updated: "2026-09-25T12:00:00.000Z",
      status: "confirmed",
      end: { dateTime: new Date(Date.now() + 3_600_000).toISOString() },
      attendees: [{ email: "one@example.com", responseStatus: "needsAction" }],
    };
    mocks.listOAuthAccounts.mockResolvedValue([{ owner: "owner@example.com" }]);
    mocks.getJevContextCredentials.mockResolvedValue({ builderAuth: "auth" });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJevThroughBuilder
      .mockRejectedValueOnce(new Error("Jev unavailable"))
      .mockResolvedValue({ answers: { event_0_0: { noul: 0 } } });
    mocks.getUserSetting.mockImplementation(
      async (owner: string, key: string) => settingsByOwner[owner]?.[key],
    );
    mocks.mutateUserSetting.mockImplementation(
      async (owner: string, key: string, update: any) => {
        const current = settingsByOwner[owner]?.[key];
        const next = typeof update === "function" ? update(current) : update;
        settingsByOwner[owner] ??= {};
        settingsByOwner[owner][key] = structuredClone(next);
        return settingsByOwner[owner][key];
      },
    );
    mocks.getClientsForAccountsWithErrors.mockResolvedValue({
      clients: [{ email: "one@example.com", accessToken: "one" }],
      errors: [],
    });
    mocks.calendarListEvents.mockResolvedValue({
      items: [event],
      nextSyncToken: "sync-token",
    });

    await expect(runCalendarEventRulesOnce()).rejects.toMatchObject({
      name: "AggregateError",
    });
    const watermark =
      settingsByOwner["owner@example.com"]["calendar-event-rules-runtime"]
        .initialSyncAt[accountKey];
    expect(watermark).toBeTruthy();
    expect(
      settingsByOwner["owner@example.com"]["calendar-event-rules-runtime"]
        .cursors,
    ).toEqual({});

    await runCalendarEventRulesOnce();

    expect(mocks.calendarListEvents).toHaveBeenCalledTimes(2);
    expect(mocks.calendarListEvents.mock.calls[0][2].timeMin).toBe(watermark);
    expect(mocks.calendarListEvents.mock.calls[1][2].timeMin).toBe(watermark);
  });

  it("reconciles a durable pending RSVP when activity persistence fails", async () => {
    const owner = "owner@example.com";
    const account = "one@example.com";
    const accountKey = `${account}:primary`;
    const event = {
      id: "event-1",
      created: new Date(Date.now() + 60_000).toISOString(),
      updated: "2026-09-25T12:00:00.000Z",
      status: "confirmed",
      end: { dateTime: new Date(Date.now() + 3_600_000).toISOString() },
      attendees: [{ email: account, responseStatus: "needsAction" }],
    };
    const updatedEvent = {
      ...event,
      attendees: [{ email: account, responseStatus: "accepted" }],
    };
    const settingsByOwner: Record<string, Record<string, any>> = {
      [owner]: {
        "calendar-settings": { eventRules: { accept: "Accept team meetings" } },
      },
    };
    let failActivityWrite = true;
    mocks.listOAuthAccounts.mockResolvedValue([{ owner }]);
    mocks.getJevContextCredentials.mockResolvedValue({ builderAuth: "auth" });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: { event_0_0: { noul: 1 } },
    });
    mocks.getUserSetting.mockImplementation(
      async (email: string, key: string) => settingsByOwner[email]?.[key],
    );
    mocks.mutateUserSetting.mockImplementation(
      async (email: string, key: string, update: any) => {
        if (key === "calendar-settings" && failActivityWrite) {
          failActivityWrite = false;
          throw new Error("settings unavailable");
        }
        const current = settingsByOwner[email]?.[key];
        const next = typeof update === "function" ? update(current) : update;
        settingsByOwner[email] ??= {};
        settingsByOwner[email][key] = structuredClone(next);
        return settingsByOwner[email][key];
      },
    );
    mocks.getClientsForAccountsWithErrors.mockResolvedValue({
      clients: [{ email: account, accessToken: "one" }],
      errors: [],
    });
    mocks.calendarListEvents
      .mockResolvedValueOnce({ items: [event], nextSyncToken: "sync-token" })
      .mockResolvedValue({
        items: [updatedEvent],
        nextSyncToken: "sync-token-2",
      });
    mocks.getEvent.mockResolvedValue({ responseStatus: "accepted" });

    await expect(runCalendarEventRulesOnce()).rejects.toMatchObject({
      name: "AggregateError",
    });

    const activityId = `google:${account}:primary:${event.id}|${event.updated}:${event.status}|accepted`;
    expect(
      settingsByOwner[owner]["calendar-event-rules-runtime"],
    ).toMatchObject({
      pendingRsvps: {
        [activityId]: { eventId: event.id, action: "accepted" },
      },
    });
    expect(mocks.rsvpEvent).toHaveBeenCalledTimes(1);

    await runCalendarEventRulesOnce();

    expect(
      settingsByOwner[owner]["calendar-settings"].eventRuleActivity,
    ).toContainEqual(
      expect.objectContaining({ id: activityId, action: "accepted" }),
    );
    expect(
      settingsByOwner[owner]["calendar-event-rules-runtime"].pendingRsvps,
    ).toEqual({});
    expect(mocks.rsvpEvent).toHaveBeenCalledTimes(1);
  });
});
