import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({ archivedAt: null })),
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

const { default: reorderDashboardPanels } =
  await import("./reorder-dashboard-panels");

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

describe("reorder-dashboard-panels", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
  });

  it("moves requested panel ids to the top in the requested order", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [
          panel("a"),
          panel("b"),
          panel("dau"),
          panel("wau"),
          panel("c"),
        ],
      },
    });

    const result: any = await reorderDashboardPanels.run({
      dashboardId: "traffic",
      panelIds: ["dau", "wau"],
    });

    expect(result.panelOrder).toEqual(["dau", "wau", "a", "b", "c"]);
    expect(result.firstPanelIds).toEqual(["dau", "wau", "a", "b", "c"]);
    expect(result.config).toBeUndefined();
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual([
      "dau",
      "wau",
      "a",
      "b",
      "c",
    ]);
  });

  it("can move panels before another panel id", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [panel("a"), panel("b"), panel("c"), panel("d")],
      },
    });

    const result: any = await reorderDashboardPanels.run({
      dashboardId: "traffic",
      panelIds: ["d"],
      beforePanelId: "b",
    });

    expect(result.panelOrder).toEqual(["a", "d", "b", "c"]);
    expect(result.insertIndex).toBe(1);
  });

  it("rejects unknown panel ids without saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [panel("a"), panel("b")],
      },
    });

    await expect(
      reorderDashboardPanels.run({
        dashboardId: "traffic",
        panelIds: ["missing"],
      }),
    ).rejects.toThrow(/panel id\(s\) not found: missing/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });
});
