import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stored: null as string | null,
  updates: [] as Array<Record<string, unknown>>,
  deletes: [] as unknown[],
  assertAccess: vi.fn(),
  listCalendarList: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: state.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  isNull: (column: unknown) => ({ kind: "is-null", column }),
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    calendarAccounts: {
      id: "calendarAccounts.id",
      enabledCalendarIdsJson: "calendarAccounts.enabledCalendarIdsJson",
    },
    calendarEvents: {
      calendarAccountId: "calendarEvents.calendarAccountId",
      calendarId: "calendarEvents.calendarId",
      meetingId: "calendarEvents.meetingId",
    },
  };
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [
          {
            id: "acct-1",
            provider: "google",
            ownerEmail: "owner@example.com",
            enabledCalendarIdsJson: state.stored,
          },
        ],
      }),
    }),
  });
  const tx = {
    select,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
    delete: () => ({
      where: async (condition: unknown) => {
        state.deletes.push(condition);
      },
    }),
  };
  return {
    getDb: () => ({
      select,
      transaction: async (run: (db: typeof tx) => unknown) => run(tx),
    }),
    schema,
  };
});

vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  lockCalendarAccount: vi.fn(async () => true),
  resolveCalendarAccessToken: vi.fn(async () => "token"),
}));

vi.mock("../server/lib/google-calendar-client.js", () => ({
  listCalendarList: state.listCalendarList,
  listEvents: vi.fn(),
}));

import action from "./set-calendar-enabled";

const TEAM = "team@group.calendar.google.com";

function run(calendarId: string, enabled: boolean) {
  return action.run(
    action.schema.parse({ accountId: "acct-1", calendarId, enabled }),
  );
}

describe("set-calendar-enabled", () => {
  beforeEach(() => {
    state.stored = null;
    state.updates = [];
    state.deletes = [];
    state.assertAccess.mockReset();
    state.listCalendarList.mockResolvedValue([
      { id: "owner@example.com", accessRole: "owner", primary: true },
      { id: TEAM, summary: "Team", accessRole: "reader" },
      { id: "busy@example.com", accessRole: "freeBusyReader" },
    ]);
  });

  it("needs edit access to the calendar account", async () => {
    state.assertAccess.mockRejectedValue(new Error("Forbidden"));

    await expect(run(TEAM, true)).rejects.toThrow("Forbidden");
    expect(state.assertAccess).toHaveBeenCalledWith(
      "calendar-account",
      "acct-1",
      "editor",
    );
    expect(state.updates).toEqual([]);
  });

  it("turns another calendar on beside the main one", async () => {
    const result = await run(TEAM, true);

    expect(state.updates).toContainEqual(
      expect.objectContaining({
        enabledCalendarIdsJson: JSON.stringify(["primary", TEAM]),
      }),
    );
    expect(result.enabledCalendarIds).toEqual(["primary", TEAM]);
    expect(state.deletes).toEqual([]);
  });

  it("won't turn on a calendar the account can't read", async () => {
    await expect(run("busy@example.com", true)).rejects.toMatchObject({
      message: expect.stringContaining("no calendar Clips can read"),
      errorCode: "calendar_not_readable",
      statusCode: 404,
    });
    expect(state.updates).toEqual([]);
  });

  it("turns a calendar off and drops its events no meeting holds", async () => {
    state.stored = JSON.stringify(["primary", TEAM]);

    const result = await run(TEAM, false);

    expect(result.enabledCalendarIds).toEqual(["primary"]);
    expect(state.deletes).toEqual([
      {
        kind: "and",
        conditions: [
          {
            kind: "eq",
            column: "calendarEvents.calendarAccountId",
            value: "acct-1",
          },
          { kind: "is-null", column: "calendarEvents.meetingId" },
          { kind: "eq", column: "calendarEvents.calendarId", value: TEAM },
        ],
      },
    ]);
  });

  it("can turn the main calendar off too", async () => {
    const result = await run("primary", false);

    expect(result.enabledCalendarIds).toEqual([]);
    expect(state.deletes[0]).toMatchObject({
      conditions: expect.arrayContaining([
        { kind: "is-null", column: "calendarEvents.calendarId" },
      ]),
    });
  });
});
