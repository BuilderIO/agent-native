import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

const tables = vi.hoisted(() => ({
  recordingViewers: {
    recordingId: "recording_viewers.recording_id",
    countedView: "recording_viewers.counted_view",
  },
  recordingViews: {
    recordingId: "recording_views.recording_id",
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

/**
 * Two counts come back per call — one per table — so the fake resolves each
 * `.where()` against the table the builder was pointed at.
 */
function createDb(rowsByTable: { viewers?: unknown[]; views?: unknown[] }) {
  const calls: {
    tables: unknown[];
    wheres: unknown[];
  } = { tables: [], wheres: [] };
  const db = {
    select() {
      let table: unknown;
      const builder = {
        from(next: unknown) {
          table = next;
          calls.tables.push(next);
          return builder;
        },
        where(condition: unknown) {
          calls.wheres.push(condition);
          return Promise.resolve(
            table === tables.recordingViews
              ? (rowsByTable.views ?? [])
              : (rowsByTable.viewers ?? []),
          );
        },
      };
      return builder;
    },
  };
  return { db, calls };
}

describe("countRecordingViews", () => {
  it("counts one view per logged view session, not per viewer", async () => {
    const { db, calls } = createDb({
      viewers: [{ value: 7 }],
      views: [{ value: 19 }],
    });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(19);

    expect(calls.tables).toEqual([
      tables.recordingViewers,
      tables.recordingViews,
    ]);
    expect(calls.wheres[0]).toEqual({
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
    expect(calls.wheres[1]).toEqual({
      type: "eq",
      left: tables.recordingViews.recordingId,
      right: "rec-1",
    });
  });

  it("falls back to the counted-viewer count for pre-migration clips", async () => {
    const { db } = createDb({ viewers: [{ value: 7 }], views: [{ value: 0 }] });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(7);
  });

  it("never reports fewer views than counted viewers", async () => {
    const { db } = createDb({
      viewers: [{ value: 11 }],
      views: [{ value: 4 }],
    });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(11);
  });

  it("returns 0 when no viewer or view rows exist", async () => {
    const { db } = createDb({});
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(0);
  });

  it("normalizes driver-provided string counts", async () => {
    const { db } = createDb({
      viewers: [{ value: "12" }],
      views: [{ value: "3" }],
    });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(12);
  });
});
