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

describe("update-dashboard demo source validation", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.dryRunQuery.mockClear();
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
  });

  it("accepts valid demo descriptors without BigQuery dry-run", async () => {
    await updateDashboard.run({
      dashboardId: "demo-test",
      config: {
        name: "Demo test",
        panels: [
          {
            id: "cpu",
            title: "CPU",
            source: "demo",
            sql: JSON.stringify({
              promql: "up",
              mode: "range",
            }),
            chartType: "line",
            width: 1,
          },
        ],
      },
    });

    expect(mocks.dryRunQuery).not.toHaveBeenCalled();
    expect(mocks.upsertDashboard).toHaveBeenCalledWith(
      "demo-test",
      "sql",
      expect.objectContaining({ name: "Demo test" }),
      { email: "alice@example.com", orgId: null },
    );
  });

  it("rejects malformed demo descriptors", async () => {
    await expect(
      updateDashboard.run({
        dashboardId: "demo-test",
        config: {
          name: "Demo test",
          panels: [
            {
              id: "bad",
              title: "Bad demo",
              source: "demo",
              sql: JSON.stringify({
                mode: "instant",
              }),
              chartType: "line",
              width: 1,
            },
          ],
        },
      }),
    ).rejects.toThrow(/demo descriptor is invalid/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });
});
