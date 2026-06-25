import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({ archivedAt: null })),
  dryRunQuery: vi.fn(),
  hasCollabState: vi.fn(async () => false),
  applyText: vi.fn(async () => undefined),
  seedFromText: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({
      app,
      view,
      params,
    }: {
      app: string;
      view: string;
      params?: { dashboardId?: string };
    }) => {
      const suffix = params?.dashboardId ? `/${params.dashboardId}` : "";
      return `/${app}/${view}${suffix}`;
    },
  ),
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));

vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: mocks.dryRunQuery,
}));

const { default: updateDashboard } = await import("./update-dashboard");

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

describe("update-dashboard proof-of-done summary", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.dryRunQuery.mockReset();
    mocks.dryRunQuery.mockResolvedValue(null);
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
  });

  it("is exposed to the dashboard editor's browser action client", () => {
    expect(updateDashboard.http).toEqual({ method: "POST" });
  });

  it("returns panelCount + summary on a full config replace", async () => {
    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      config: {
        name: "Weekly",
        panels: [panel("a"), panel("b"), panel("c")],
      },
    });

    expect(result.panelCount).toBe(3);
    expect(result.appliedOps).toBe(0);
    expect(result.summary).toMatch(/3 panel/);
    expect(result.config).toBeDefined();
  });

  it("returns appliedOps + resulting panelCount after batched insert ops", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a")] },
    });

    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      ops: [
        { op: "insert", path: "/panels/-", value: panel("b") },
        { op: "insert", path: "/panels/-", value: panel("c") },
      ],
    });

    expect(result.appliedOps).toBe(2);
    expect(result.panelCount).toBe(3);
    expect(result.summary).toMatch(/Applied 2 op\(s\)/);
    expect(result.summary).toMatch(/3 panel/);
    // Saved once, atomically, with all three panels.
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
