import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reproduces the 2026-09-24 data-loss bug: a panel delete and a panel edit
 * from a stale (pre-delete) client snapshot land as two full-`config`
 * `update-dashboard` calls. Without a concurrency fence, the second
 * (stale) full-config write silently overwrites the first, resurrecting the
 * deleted panel. This models `upsertDashboard`'s real `expectedUpdatedAt`
 * fencing (see `server/lib/dashboards-store.ts`) with an in-memory "row" so
 * the test exercises the same compare-and-swap contract the real store
 * enforces, without touching Postgres.
 */
const mocks = vi.hoisted(() => {
  class DashboardConflictError extends Error {
    constructor(id: string) {
      super(`Dashboard "${id}" changed between read and write.`);
      this.name = "DashboardConflictError";
    }
  }
  return {
    DashboardConflictError,
    dryRunQuery: vi.fn(async () => null),
    hasCollabState: vi.fn(async () => false),
    applyText: vi.fn(async () => undefined),
    seedFromText: vi.fn(async () => undefined),
  };
});

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/analytics/adhoc"),
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));

vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: mocks.dryRunQuery,
}));

// In-memory stand-in for the `dashboards` row this action reads/writes,
// fencing writes exactly like the real `upsertDashboard(..., expectedUpdatedAt)`:
// a write whose `expectedUpdatedAt` doesn't match the row's current
// `updatedAt` is rejected with `DashboardConflictError` instead of applying.
let row: { config: Record<string, unknown>; updatedAt: string } | null = null;
let nextUpdatedAt = 0;

vi.mock("../server/lib/dashboards-store", () => ({
  DashboardConflictError: mocks.DashboardConflictError,
  upsertDashboard: vi.fn(
    async (
      _id: string,
      _kind: string,
      config: Record<string, unknown>,
      _ctx: unknown,
      expectedUpdatedAt?: string,
    ) => {
      if (
        row &&
        expectedUpdatedAt !== undefined &&
        row.updatedAt !== expectedUpdatedAt
      ) {
        throw new mocks.DashboardConflictError(_id);
      }
      nextUpdatedAt += 1;
      row = { config, updatedAt: `t${nextUpdatedAt}` };
      return { ...row };
    },
  ),
  upsertDashboardWithRetry: vi.fn(),
}));

const { default: updateDashboard } = await import("./update-dashboard");

// `source: "demo"` needs no real database/schema probe (unlike "first-party"
// or "bigquery"), keeping this concurrency test isolated and fast.
function panel(id: string) {
  return {
    id,
    title: id,
    source: "demo",
    chartType: "line",
    width: 1,
    sql: JSON.stringify({ promql: "up", mode: "range" }),
  };
}

describe("update-dashboard config-replace concurrency fence", () => {
  beforeEach(() => {
    row = null;
    nextUpdatedAt = 0;
  });

  it("rejects a stale full-config save instead of resurrecting a panel a concurrent delete removed", async () => {
    // Initial load: dashboard has panel A (TMP event inventory) and panel B.
    const initial = { name: "Growth health", panels: [panel("a"), panel("b")] };
    const created: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: initial,
    });
    const loadedUpdatedAt = created.updatedAt;
    expect(loadedUpdatedAt).toBeDefined();

    // Tab deletes panel A, saving the config it observed after loading.
    const afterDelete: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: { name: "Growth health", panels: [panel("b")] },
      expectedUpdatedAt: loadedUpdatedAt,
    });
    expect(afterDelete.panelOrder).toEqual(["b"]);

    // Without reloading, the same tab edits panel B — but the payload is
    // built from the PRE-delete snapshot (still fenced by `loadedUpdatedAt`),
    // exactly like a stale client cache or a second tab would send.
    const staleEditWithA = {
      name: "Growth health",
      panels: [panel("a"), { ...panel("b"), title: "Weekly active users v2" }],
    };

    await expect(
      updateDashboard.run({
        dashboardId: "growth-health",
        config: staleEditWithA,
        expectedUpdatedAt: loadedUpdatedAt,
      }),
    ).rejects.toThrow(/changed .* since you loaded it/i);

    // The rejected write must not have applied: panel A stays deleted and
    // panel B keeps the value the delete's own save persisted.
    expect(row?.config).toEqual({
      name: "Growth health",
      panels: [panel("b")],
    });
    expect(row?.updatedAt).toBe(afterDelete.updatedAt);
  });

  it("still allows a same-tab follow-up save fenced with the delete's own fresh updatedAt", async () => {
    const initial = { name: "Growth health", panels: [panel("a"), panel("b")] };
    const created: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: initial,
    });

    const afterDelete: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: { name: "Growth health", panels: [panel("b")] },
      expectedUpdatedAt: created.updatedAt,
    });

    // A follow-up edit fenced against the DELETE's own returned `updatedAt`
    // (what the fixed client now tracks) must succeed — the fence only
    // rejects writes based on stale reads, not legitimate same-tab chains.
    const editedB = {
      name: "Growth health",
      panels: [{ ...panel("b"), title: "Weekly active users v2" }],
    };
    const afterEdit: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: editedB,
      expectedUpdatedAt: afterDelete.updatedAt,
    });

    expect(afterEdit.panelOrder).toEqual(["b"]);
    expect(row?.config).toEqual(editedB);
  });
});
