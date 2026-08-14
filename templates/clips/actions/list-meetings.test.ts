import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  where: null as unknown,
  limit: null as number | null,
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
  const schema = {
    meetings,
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
        state.where = condition;
        return builder;
      });
      builder.orderBy = vi.fn(() => builder);
      builder.limit = vi.fn((value: number) => {
        state.limit = value;
        return builder;
      });
      builder.offset = vi.fn(async () => state.rows);
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
    state.where = null;
    state.limit = null;
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
    expect(state.where).toMatchObject({ kind: "and" });
    expect(
      (state.where as { conditions: Array<{ kind?: string }> }).conditions,
    ).toContainEqual(expect.objectContaining({ kind: "or" }));
  });
});
