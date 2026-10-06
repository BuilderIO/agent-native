import { beforeEach, describe, expect, it, vi } from "vitest";

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
    const initial = { name: "Growth health", panels: [panel("a"), panel("b")] };
    const created: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: initial,
    });
    const loadedUpdatedAt = created.updatedAt;
    expect(loadedUpdatedAt).toBeDefined();

    const afterDelete: any = await updateDashboard.run({
      dashboardId: "growth-health",
      config: { name: "Growth health", panels: [panel("b")] },
      expectedUpdatedAt: loadedUpdatedAt,
    });
    expect(afterDelete.panelOrder).toEqual(["b"]);

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
