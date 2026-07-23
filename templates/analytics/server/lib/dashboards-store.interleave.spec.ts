/**
 * Regression coverage for the dashboards `config` read/modify/write race.
 *
 * `upsertDashboard` used to write the whole `config` JSON blob keyed only by
 * `id`, with no version/lock check. Two concurrent writers that both read the
 * same base (agent adds a panel while a human drags one) silently clobbered
 * each other — last writer wins over the whole blob. `upsertDashboard` now
 * accepts an optional `expectedUpdatedAt` fence, and `upsertDashboardWithRetry`
 * re-reads + re-applies a mutation when that fence loses a race.
 *
 * The fake database below deliberately loses the first fenced write once
 * (`state.loseNextCas`) to simulate a concurrent writer landing in between,
 * mirroring templates/design/actions/design-data-mutations.interleave.spec.ts's
 * CAS-retry fixture for the same class of bug.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DashboardRow = {
  id: string;
  kind: string;
  title: string;
  config: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
};

function panel(id: string) {
  return {
    id,
    title: id,
    source: "first-party",
    chartType: "metric",
    width: 1,
    sql: "SELECT COUNT(*) AS value FROM analytics_events",
  };
}

function baseDashboard(): DashboardRow {
  return {
    id: "traffic",
    kind: "sql",
    title: "Traffic",
    config: JSON.stringify({ name: "Traffic", panels: [panel("a")] }),
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    updatedBy: null,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  };
}

const state = vi.hoisted(() => ({
  dashboard: {
    id: "traffic",
    kind: "sql",
    title: "Traffic",
    config: JSON.stringify({ name: "Traffic", panels: [{ id: "a" }] }),
    ownerEmail: "alice@example.com",
    orgId: null as string | null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    updatedBy: null as string | null,
    archivedAt: null as string | null,
    hiddenAt: null as string | null,
    hiddenBy: null as string | null,
  },
  revisions: [] as any[],
  // One-shot flag: the next fenced UPDATE attempt against `dashboards`
  // simulates a concurrent writer (adding a panel of its own) landing in
  // between the caller's read and write, then reports zero affected rows —
  // exactly what a real `WHERE id = ? AND updated_at = ?` reports when
  // someone else already moved `updated_at`.
  loseNextCas: false,
  // When true, every fenced UPDATE attempt loses the race forever, to prove
  // upsertDashboardWithRetry gives up loud instead of looping forever.
  alwaysLoseCas: false,
  updateAttempts: 0,
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
    return (p.conditions ?? []).every((condition) =>
      matchesRow(condition, row),
    );
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
    resolveAccess: async () => ({
      role: "editor",
      resource: { ...state.dashboard },
    }),
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
    // Not exercised by these tests, but `dashboards-store.ts` builds a
    // module-scope column-projection constant (`analysisListColumns`) from
    // `schema.analyses` at import time, so it must exist to avoid a crash
    // on import.
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
          if (table === schema.dashboardRevisions) {
            return rowsResult(
              state.revisions.filter((r) => matchesRow(predicate, r)),
            );
          }
          return rowsResult(
            matchesRow(predicate, state.dashboard)
              ? [{ ...state.dashboard }]
              : [],
          );
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: any) => {
        if (table === schema.dashboardRevisions) {
          state.revisions.push({ ...row });
        }
        const p: any = Promise.resolve(undefined);
        p.onConflictDoNothing = async () => undefined;
        return p;
      },
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        if (table === schema.dashboardRevisions) {
          state.revisions = state.revisions.filter(
            (r) => !matchesRow(predicate, r),
          );
        }
        return undefined;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Partial<DashboardRow>) => ({
        where: async (predicate: unknown) => {
          if (table !== schema.dashboards) return { rowsAffected: 0 };
          state.updateAttempts += 1;
          if (state.alwaysLoseCas) {
            // Every attempt loses: a different writer keeps landing first.
            state.dashboard = {
              ...state.dashboard,
              updatedAt: `2026-07-09T00:00:00.${String(state.updateAttempts).padStart(3, "0")}Z`,
            };
            return { rowsAffected: 0 };
          }
          if (state.loseNextCas) {
            state.loseNextCas = false;
            const concurrentConfig = JSON.parse(state.dashboard.config);
            state.dashboard = {
              ...state.dashboard,
              config: JSON.stringify({
                ...concurrentConfig,
                panels: [...(concurrentConfig.panels ?? []), panel("writer-a")],
              }),
              updatedAt: "2026-07-09T00:00:00.001Z",
              updatedBy: "bob@example.com",
            };
            return { rowsAffected: 0 };
          }
          if (!matchesRow(predicate, state.dashboard)) {
            return { rowsAffected: 0 };
          }
          state.dashboard = { ...state.dashboard, ...values } as DashboardRow;
          return { rowsAffected: 1 };
        },
      }),
    }),
  };

  return { schema, getDb: () => db };
});

const {
  getDashboard,
  upsertDashboard,
  upsertDashboardWithRetry,
  DashboardConflictError,
  DASHBOARD_SAVE_MAX_ATTEMPTS,
} = await import("./dashboards-store.js");

const ctx = { email: "alice@example.com", orgId: null };

function readPanelIds(): string[] {
  const config = JSON.parse(state.dashboard.config) as {
    panels: Array<{ id: string }>;
  };
  return config.panels.map((p) => p.id);
}

beforeEach(() => {
  state.dashboard = baseDashboard();
  state.revisions = [];
  state.loseNextCas = false;
  state.alwaysLoseCas = false;
  state.updateAttempts = 0;
});

describe("dashboards-store concurrency", () => {
  it("fences the write and rejects a stale expectedUpdatedAt", async () => {
    const existing = await getDashboard("traffic", ctx);
    expect(existing).not.toBeNull();

    // First writer saves using the value it read — succeeds and bumps
    // updated_at.
    await upsertDashboard(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a"), panel("b")] },
      ctx,
      existing!.updatedAt,
    );
    expect(readPanelIds()).toEqual(["a", "b"]);

    // Second writer still holds the OLD updatedAt it read before the first
    // writer's save landed — the fenced write must reject, not clobber.
    await expect(
      upsertDashboard(
        "traffic",
        "sql",
        { name: "Traffic", panels: [panel("a"), panel("c")] },
        ctx,
        existing!.updatedAt,
      ),
    ).rejects.toBeInstanceOf(DashboardConflictError);
    // The first writer's save is untouched by the rejected second attempt.
    expect(readPanelIds()).toEqual(["a", "b"]);
  });

  it("omits fencing (legacy last-write-wins) when expectedUpdatedAt is not passed", async () => {
    const existing = await getDashboard("traffic", ctx);
    // Simulate the row having changed since `existing` was read.
    state.dashboard = {
      ...state.dashboard,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    await expect(
      upsertDashboard(
        "traffic",
        "sql",
        { name: "Traffic", panels: [panel("a"), panel("legacy")] },
        ctx,
        // no expectedUpdatedAt — existing callers (legacy migration, revision
        // restore) keep unconditional overwrite behavior.
      ),
    ).resolves.toBeDefined();
    expect(existing).not.toBeNull();
    expect(readPanelIds()).toEqual(["a", "legacy"]);
  });

  it("upsertDashboardWithRetry re-reads and re-applies the mutation after losing the race, landing both writers' panels", async () => {
    state.loseNextCas = true;

    const saved = await upsertDashboardWithRetry("traffic", ctx, (existing) => {
      const config = existing.config as { name: string; panels: unknown[] };
      return {
        kind: "sql" as const,
        body: {
          ...config,
          panels: [...config.panels, panel("writer-b")],
        },
      };
    });

    // "writer-a" was injected by the simulated concurrent writer on the lost
    // first attempt; "writer-b" is this call's own mutation. Both must be
    // present — neither writer's edit was dropped.
    const ids = (saved.config as { panels: Array<{ id: string }> }).panels.map(
      (p) => p.id,
    );
    expect(ids).toEqual(["a", "writer-a", "writer-b"]);
    expect(readPanelIds()).toEqual(["a", "writer-a", "writer-b"]);
    expect(state.updateAttempts).toBe(2);
  });

  it("gives up with a clear error after repeated conflicts instead of looping forever", async () => {
    state.alwaysLoseCas = true;

    await expect(
      upsertDashboardWithRetry("traffic", ctx, (existing) => {
        const config = existing.config as { name: string; panels: unknown[] };
        return {
          kind: "sql" as const,
          body: { ...config, panels: [...config.panels, panel("never-lands")] },
        };
      }),
    ).rejects.toThrow(/Could not save dashboard "traffic"/);

    expect(state.updateAttempts).toBe(DASHBOARD_SAVE_MAX_ATTEMPTS);
    // Nothing from the doomed mutation ever landed.
    expect(readPanelIds()).toEqual(["a"]);
  });
});
