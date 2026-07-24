import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

const tables = vi.hoisted(() => ({
  recordingViewers: {
    recordingId: "recording_viewers.recording_id",
    countedView: "recording_viewers.counted_view",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  count: () => ({ type: "count" }),
  desc: (column: unknown) => ({ type: "desc", column }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("h3", () => ({ HTTPError: class extends Error {} }));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  implicitServiceOrgRole: vi.fn(),
  orgMembers: { orgId: "org_members.org_id", email: "org_members.email" },
}));

vi.mock("@agent-native/core/server", () => ({ getSession: vi.fn() }));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: tables,
}));

import { countedViewCondition, countRecordingViews } from "./recordings.js";

function createDb(rows: unknown[]) {
  const calls: { table?: unknown; where?: unknown } = {};
  const builder = {
    from(table: unknown) {
      calls.table = table;
      return builder;
    },
    where(condition: unknown) {
      calls.where = condition;
      return Promise.resolve(rows);
    },
  };
  return { db: { select: () => builder }, calls };
}

describe("countRecordingViews", () => {
  it("counts only counted-view viewer rows for the recording", async () => {
    const { db, calls } = createDb([{ value: 7 }]);
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(7);

    expect(calls.table).toBe(tables.recordingViewers);
    expect(calls.where).toEqual({
      type: "and",
      conditions: [
        {
          type: "eq",
          left: tables.recordingViewers.recordingId,
          right: "rec-1",
        },
        countedViewCondition(),
      ],
    });
  });

  it("returns 0 when no viewer rows exist", async () => {
    const { db } = createDb([]);
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(0);
  });

  it("normalizes driver-provided string counts", async () => {
    const { db } = createDb([{ value: "12" }]);
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(12);
  });
});
