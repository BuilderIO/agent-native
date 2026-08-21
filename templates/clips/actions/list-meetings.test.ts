import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  // The action now issues two `.where()` calls per run — the meetings query
  // and, when persisted rows come back, a second batched participants fetch —
  // so both must be captured rather than one overwriting the other.
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
    calendarAccounts: {},
    calendarAccountShares: {},
    calendarEvents: {},
  };
  const db = {
    select: vi.fn(() => {
      const builder: Record<string, (...args: any[]) => any> = {};
      builder.from = vi.fn(() => builder);
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
      // The participants batch fetch is `await db.select()...where(...)` with
      // no further chaining, so `builder` itself must be thenable — it
      // resolves to no participants here since these tests don't exercise
      // that path; `.offset()` above (a real async function) still governs
      // the meetings query's own resolution.
      builder.then = (resolve: (value: unknown[]) => void) => resolve([]);
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
    state.whereCalls = [];
    state.limit = null;
    state.offset = null;
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

  // Regression: an earlier fix kept "Load older" reachable past 500 rows by
  // growing the fetch-from-zero window (`offset + limit + 1`), which still
  // hard-caps at 500 total rows no matter how large `offset` gets — offset
  // 500 would ask for the same first-500-row window and always come back
  // empty. Real per-page DB offset has no such ceiling: the LIMIT stays
  // bounded to this page's size regardless of how deep `offset` reaches.
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
});
