import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calendarAccounts: [] as Array<Record<string, unknown>>,
  whereCalls: [] as unknown[],
  limit: null as number | null,
  offset: null as number | null,
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access-filter" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: (column: unknown) => ({ kind: "asc", column }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  gte: (column: unknown, value: unknown) => ({ kind: "gte", column, value }),
  inArray: (column: unknown, values: unknown) => ({
    kind: "in-array",
    column,
    values,
  }),
  isNotNull: (column: unknown) => ({ kind: "is-not-null", column }),
  isNull: (column: unknown) => ({ kind: "is-null", column }),
  lt: (column: unknown, value: unknown) => ({ kind: "lt", column, value }),
  lte: (column: unknown, value: unknown) => ({ kind: "lte", column, value }),
  ne: (column: unknown, value: unknown) => ({ kind: "ne", column, value }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock("../server/db/index.js", () => {
  const meetings = {
    id: "meetings.id",
    scheduledStart: "meetings.scheduledStart",
    scheduledEnd: "meetings.scheduledEnd",
    actualStart: "meetings.actualStart",
    actualEnd: "meetings.actualEnd",
    recordingId: "meetings.recordingId",
    summaryMd: "meetings.summaryMd",
    userNotesMd: "meetings.userNotesMd",
    bulletsJson: "meetings.bulletsJson",
    actionItemsJson: "meetings.actionItemsJson",
    createdAt: "meetings.createdAt",
    trashedAt: "meetings.trashedAt",
    calendarEventId: "meetings.calendarEventId",
    source: "meetings.source",
  };
  const meetingParticipants = {
    id: "meetingParticipants.id",
    meetingId: "meetingParticipants.meetingId",
    email: "meetingParticipants.email",
    name: "meetingParticipants.name",
  };
  const schema = {
    meetings,
    meetingParticipants,
    meetingShares: "meetingShares",
    calendarAccounts: {
      id: "calendarAccounts.id",
      status: "calendarAccounts.status",
    },
    calendarAccountShares: {},
    calendarEvents: {},
  };
  const db = {
    select: vi.fn(() => {
      const builder: Record<string, (...args: any[]) => any> = {};
      let selectedTable: unknown;
      builder.from = vi.fn((table: unknown) => {
        selectedTable = table;
        return builder;
      });
      builder.where = vi.fn((condition: unknown) => {
        state.whereCalls.push(condition);
        return builder;
      });
      builder.orderBy = vi.fn(() => builder);
      builder.limit = vi.fn((value: number) => {
        state.limit = value;
        return builder;
      });
      builder.offset = vi.fn(async (value: number) => {
        state.offset = value;
        return state.rows;
      });
      builder.then = (resolve: (value: unknown[]) => void) =>
        resolve(
          selectedTable === schema.calendarAccounts
            ? state.calendarAccounts
            : [],
        );
      return builder;
    }),
  };
  return { getDb: () => db, schema };
});

vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  calendarEventToMeetingView: vi.fn(),
  eventEndIso: vi.fn(),
  eventStartIso: vi.fn(),
  isTimedCalendarEvent: vi.fn(),
  recordCalendarFetchError: vi.fn(),
  recordCalendarFetchSuccess: vi.fn(),
  resolveCalendarAccessToken: vi.fn(),
}));

vi.mock("../server/lib/google-calendar-client.js", () => ({
  listEvents: vi.fn(),
}));

import {
  recordCalendarFetchError,
  recordCalendarFetchSuccess,
  resolveCalendarAccessToken,
} from "../server/lib/calendar-event-meetings";
import { listEvents } from "../server/lib/google-calendar-client";
import { AGENT_MEETINGS_PER_CALL } from "./lib/meeting-content";
import action from "./list-meetings";

const meeting = (id: string) => ({
  id,
  title: id,
  scheduledStart: "2026-08-14T17:00:00.000Z",
  scheduledEnd: "2026-08-14T17:30:00.000Z",
  actualStart: "2026-08-14T17:00:00.000Z",
  actualEnd: "2026-08-14T17:30:00.000Z",
  recordingId: null,
  summaryMd: "",
  userNotesMd: "notes",
  bulletsJson: "[]",
  actionItemsJson: "[]",
  createdAt: "2026-08-14T17:00:00.000Z",
  trashedAt: null,
  calendarEventId: null,
  source: "adhoc",
});

describe("list-meetings history", () => {
  beforeEach(() => {
    state.rows = [];
    state.calendarAccounts = [];
    state.whereCalls = [];
    vi.mocked(recordCalendarFetchError).mockReset();
    vi.mocked(resolveCalendarAccessToken).mockReset();
    state.limit = null;
    state.offset = null;
  });

  it("marks a null calendar token as an explicit reauthentication failure", async () => {
    const calendarAccount = {
      id: "calendar-1",
      provider: "google",
      ownerEmail: "owner@example.com",
    };
    state.calendarAccounts = [calendarAccount];
    vi.mocked(resolveCalendarAccessToken).mockResolvedValue(null);
    vi.mocked(recordCalendarFetchError).mockResolvedValue({
      accountId: calendarAccount.id,
      error: "Token refresh failed",
      needsReauth: true,
    });
    const parsed = action.schema.parse({ view: "upcoming" });

    await action.run(parsed);

    expect(recordCalendarFetchError).toHaveBeenCalledWith(
      calendarAccount,
      expect.objectContaining({ message: "Token refresh failed" }),
      { needsReauth: true },
    );
  });

  it("says when a calendar read stopped with events still to read", async () => {
    state.calendarAccounts = [
      { id: "calendar-1", provider: "google", ownerEmail: "owner@example.com" },
    ];
    vi.mocked(resolveCalendarAccessToken).mockResolvedValue("token");
    vi.mocked(recordCalendarFetchSuccess).mockResolvedValue(undefined);
    vi.mocked(listEvents).mockResolvedValueOnce({
      items: [],
      nextPageToken: "page-6",
    });
    expect(
      await action.run(action.schema.parse({ view: "upcoming" })),
    ).toMatchObject({ calendarErrors: [], calendarCapped: true });

    vi.mocked(listEvents).mockResolvedValueOnce({ items: [] });
    expect(
      await action.run(action.schema.parse({ view: "upcoming" })),
    ).toMatchObject({ calendarErrors: [], calendarCapped: false });
  });

  it("accepts content-aware history queries without recordedOnly", () => {
    const parsed = action.schema.parse({
      view: "past",
      hasContent: "true",
      includeLiveCalendar: "false",
    });

    expect(parsed).toMatchObject({
      view: "past",
      hasContent: true,
      recordedOnly: false,
      includeLiveCalendar: false,
    });
  });

  it("returns a page and reports when older meetings remain", async () => {
    state.rows = [meeting("meeting-1"), meeting("meeting-2")];
    const parsed = action.schema.parse({
      view: "past",
      hasContent: true,
      includeLiveCalendar: false,
      limit: 1,
    });

    const result = await action.run(parsed);

    expect(result.meetings).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(state.limit).toBe(2);
    const meetingsWhere = state.whereCalls[0] as {
      kind?: string;
      conditions?: Array<{ kind?: string }>;
    };
    expect(meetingsWhere).toMatchObject({ kind: "and" });
    expect(meetingsWhere.conditions).toContainEqual(
      expect.objectContaining({ kind: "or" }),
    );
  });

  it("paginates for real in SQL, so history is reachable arbitrarily far past 500 rows", async () => {
    const parsed = action.schema.parse({
      view: "past",
      hasContent: true,
      includeLiveCalendar: false,
      limit: 50,
      offset: 4500,
    });

    await action.run(parsed);

    expect(state.limit).toBe(51);
    expect(state.offset).toBe(4500);
  });

  describe("for agents", () => {
    const history = (includeLiveCalendar: boolean) =>
      action.schema.parse({
        view: "past",
        hasContent: true,
        includeLiveCalendar,
        limit: 100,
      });

    beforeEach(() => {
      state.rows = Array.from({ length: 30 }, (_, index) => ({
        ...meeting(`meeting-${index}`),
        summaryMd: "# Summary\n\nWe agreed to ship.",
        bulletsJson: '[{"text":"Ship"}]',
        actionItemsJson: '[{"text":"Ship it"}]',
      }));
    });

    it.each([
      ["mcp", false],
      ["a2a", false],
      ["tool", false],
      ["webmcp", false],
      ["mcp", true],
    ])(
      "gives a %s caller one page of short rows (live calendar: %s)",
      async (caller, includeLiveCalendar) => {
        const result = await action.run(history(includeLiveCalendar), {
          caller,
        } as never);

        expect(result.meetings).toHaveLength(AGENT_MEETINGS_PER_CALL);
        expect(result.hasMore).toBe(true);
        expect(result.meetings[0]).toMatchObject({
          summaryPreview: "# Summary We agreed to ship.",
          hasNotes: true,
          actionItemCount: 1,
        });
        for (const field of [
          "summaryMd",
          "userNotesMd",
          "bulletsJson",
          "actionItemsJson",
        ]) {
          expect(result.meetings[0]).not.toHaveProperty(field);
        }
      },
    );

    it("reads the next page from the offset it was given", async () => {
      await action.run(
        action.schema.parse({
          view: "past",
          includeLiveCalendar: false,
          limit: 100,
          offset: 25,
        }),
        { caller: "mcp" } as never,
      );

      expect(state.limit).toBe(AGENT_MEETINGS_PER_CALL + 1);
      expect(state.offset).toBe(25);
    });

    it("says when older meetings sit past the live calendar merge", async () => {
      state.rows = Array.from({ length: 1001 }, (_, index) =>
        meeting(`meeting-${index}`),
      );
      const page = (offset: number) =>
        action.run(action.schema.parse({ view: "past", limit: 25, offset }), {
          caller: "mcp",
        } as never);

      expect(await page(950)).toMatchObject({
        hasMore: true,
        historyCapped: false,
      });
      const pastTheMerge = await page(1000);
      expect(pastTheMerge.meetings).toHaveLength(0);
      expect(pastTheMerge).toMatchObject({
        hasMore: false,
        historyCapped: true,
      });

      state.rows = state.rows.slice(0, 1000);
      expect(await page(1000)).toMatchObject({
        hasMore: false,
        historyCapped: false,
      });
    });

    it("leaves the app's own lists whole", async () => {
      const result = await action.run(history(false), {
        caller: "frontend",
      } as never);

      expect(result.meetings).toHaveLength(30);
      expect(result.meetings[0]).toMatchObject({
        summaryMd: "# Summary\n\nWe agreed to ship.",
        userNotesMd: "notes",
        bulletsJson: '[{"text":"Ship"}]',
      });
    });
  });
});
