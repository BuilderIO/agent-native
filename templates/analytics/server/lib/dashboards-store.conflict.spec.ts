/**
 * Regression coverage for `upsertDashboard`'s create-branch conflict handling.
 *
 *  - Insert conflict: a row with this id already exists but the caller cannot
 *    access it under the current scope, and it is NOT the caller's own private
 *    row. The method must surface `DashboardConflictError` instead of leaking
 *    the foreign row.
 *  - Stale-org recovery: the caller's OWN private row (e.g. a per-user demo
 *    dashboard whose orgId no longer matches) is recovered, not rejected.
 *  - Missing post-write row: the SELECT after the write returns nothing (a
 *    concurrent delete raced the write). The method must throw
 *    `DashboardConflictError` instead of dereferencing `undefined`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  // What the access-scoped resolveAccess grants. null => no access.
  access: null as { role: string; resource: Record<string, unknown> } | null,
  // Rows returned by the post-write `select().from(dashboards).where(id)`.
  selectRows: [] as Array<Record<string, unknown>>,
}));

function columnName(column: unknown): string | null {
  if (!column || typeof column !== "object") return null;
  return (column as { name?: string }).name ?? null;
}

function matchesRow(predicate: unknown, row: Record<string, unknown>): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const p = predicate as {
    kind?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };
  if (p.kind === "and") {
    return (p.conditions ?? []).every((c) => matchesRow(c, row));
  }
  if (p.kind === "eq") {
    const name = columnName(p.column);
    return name ? row[name] === p.value : true;
  }
  return true;
}

function rowsResult(rows: unknown[]) {
  const result: any = Promise.resolve(rows);
  result.orderBy = () => rowsResult(rows);
  result.limit = () => rowsResult(rows);
  return result;
}

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
  isNotNull: (column: unknown) => ({ kind: "isNotNull", column }),
}));

vi.mock("@agent-native/core/server", () => ({
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: async () => ({}),
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => undefined,
  deleteUserSetting: async () => undefined,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    resolveAccess: async () => state.access,
    assertAccess: async () => ({ role: "editor" }),
  };
});

vi.mock("../db/index.js", () => {
  const schema = {
    dashboards: {
      id: { name: "id" },
      kind: { name: "kind" },
      title: { name: "title" },
      config: { name: "config" },
      updatedAt: { name: "updatedAt" },
      updatedBy: { name: "updatedBy" },
    },
    dashboardRevisions: {
      id: { name: "id" },
      dashboardId: { name: "dashboardId" },
      createdAt: { name: "createdAt" },
    },
    analyses: {
      id: { name: "id" },
      name: { name: "name" },
      description: { name: "description" },
      question: { name: "question" },
      instructions: { name: "instructions" },
      dataSources: { name: "dataSources" },
      author: { name: "author" },
      ownerEmail: { name: "ownerEmail" },
      orgId: { name: "orgId" },
      visibility: { name: "visibility" },
      createdAt: { name: "createdAt" },
      updatedAt: { name: "updatedAt" },
      hiddenAt: { name: "hiddenAt" },
      hiddenBy: { name: "hiddenBy" },
    },
  };

  const db = {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          if (table === schema.dashboardRevisions) return rowsResult([]);
          return rowsResult(
            state.selectRows.filter((r) => matchesRow(predicate, r)),
          );
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_row: any) => {
        const p: any = Promise.resolve(undefined);
        p.onConflictDoNothing = async () => undefined;
        return p;
      },
    }),
    update: (_table: unknown) => ({
      set: () => ({ where: async () => ({ rowsAffected: 1 }) }),
    }),
  };

  return { schema, getDb: () => db };
});

const { upsertDashboard, DashboardConflictError } =
  await import("./dashboards-store.js");

const ctx = { email: "alice@example.com", orgId: null };
const body = { name: "New", panels: [] };

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "id",
    kind: "sql",
    title: "Title",
    config: JSON.stringify({ name: "x", panels: [] }),
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    updatedBy: null,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.access = null;
  state.selectRows = [];
});

describe("dashboards-store insert conflict", () => {
  it("throws a conflict when the pre-existing row belongs to another user", async () => {
    // No scoped access before OR after insert (foreign row that
    // onConflictDoNothing left untouched), owned by someone else.
    state.access = null;
    state.selectRows = [
      row({ id: "shared-id", ownerEmail: "mallory@example.com", orgId: "o" }),
    ];

    await expect(
      upsertDashboard("shared-id", "sql", body, ctx),
    ).rejects.toBeInstanceOf(DashboardConflictError);
  });

  it("recovers an own private row created under a stale org scope", async () => {
    // Scoped access denies the row (its orgId no longer matches the null-org
    // caller), but it is the caller own PRIVATE row: the per-user demo/seed
    // recovery case. Must NOT throw; returns the existing row.
    state.access = null;
    state.selectRows = [
      row({ id: "demo-abc", orgId: "stale-org", visibility: "private" }),
    ];

    const result = await upsertDashboard("demo-abc", "sql", body, ctx);
    expect(result.id).toBe("demo-abc");
  });

  it("recovers (re-owns) an own org-visibility row into the current scope", async () => {
    // The production demo case: alice owns this id but it was created under an
    // org scope she is no longer in, so scoped access denies it. Because she is
    // the owner it must be re-owned and returned, not thrown.
    state.access = null;
    state.selectRows = [
      row({ id: "org-shared", orgId: "other-org", visibility: "org" }),
    ];

    const result = await upsertDashboard("org-shared", "sql", body, ctx);
    expect(result.id).toBe("org-shared");
  });

  it("throws a conflict when the post-write row is missing (raced delete)", async () => {
    // Update branch: caller has access, so existing is truthy...
    state.access = { role: "editor", resource: row({ id: "raced" }) };
    // ...but the post-write SELECT finds nothing (concurrent delete).
    state.selectRows = [];

    await expect(
      upsertDashboard("raced", "sql", body, ctx),
    ).rejects.toBeInstanceOf(DashboardConflictError);
  });
});
