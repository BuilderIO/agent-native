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
        settingsByOwner[owner][key] = next;
        return next;
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
});
