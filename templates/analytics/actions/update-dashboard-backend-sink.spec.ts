import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({ archivedAt: null })),
  dryRunQuery: vi.fn(),
  hasCollabState: vi.fn(async () => false),
  applyText: vi.fn(async () => undefined),
  seedFromText: vi.fn(async () => undefined),
  getScopedSettingRecord: vi.fn(),
  putScopedSettingRecord: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/analytics/adhoc"),
  getRequestOrgId: () => "org-1",
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
  getBigQueryProjectId: vi.fn(async () => "builder-3b0a2"),
  runQuery: vi.fn(),
}));

vi.mock("../server/lib/scoped-settings.js", () => ({
  getScopedSettingRecord: mocks.getScopedSettingRecord,
  putScopedSettingRecord: mocks.putScopedSettingRecord,
}));

const { default: updateDashboard } = await import("./update-dashboard");
const { resetFirstPartyAnalyticsBackendCacheForTests } =
  await import("../server/lib/first-party-analytics-backend");

function dashboardWith(sql: string) {
  return {
    dashboardId: "sink-test",
    config: {
      name: "Sink test",
      panels: [
        {
          id: "weekly",
          title: "All-time weekly signups",
          source: "first-party",
          chartType: "line",
          width: 1,
          config: { timeScope: "all-time" },
          sql,
        },
      ],
    },
  };
}

describe("update-dashboard validates against the scope's active sink", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.getScopedSettingRecord.mockReset();
    resetFirstPartyAnalyticsBackendCacheForTests();
  });

  it("rejects a panel the active BigQuery backend cannot run, naming the construct", async () => {
    mocks.getScopedSettingRecord.mockResolvedValue({ sink: "bigquery" });

    await expect(
      updateDashboard.run(
        dashboardWith(
          "SELECT date_trunc('hour', timestamp) AS d, COUNT(*) AS c FROM analytics_events GROUP BY 1",
        ),
      ),
    ).rejects.toThrow(/date_trunc\('hour', \.\.\.\)/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("accepts the same panel while the scope is still on PostgreSQL", async () => {
    mocks.getScopedSettingRecord.mockResolvedValue({ sink: "postgres" });

    await updateDashboard.run(
      dashboardWith(
        "SELECT date_trunc('hour', timestamp) AS d, COUNT(*) AS c FROM analytics_events GROUP BY 1",
      ),
    );

    expect(mocks.upsertDashboard).toHaveBeenCalled();
  });

  it("accepts BigQuery-translatable first-party SQL under the BigQuery sink", async () => {
    mocks.getScopedSettingRecord.mockResolvedValue({ sink: "bigquery" });

    await updateDashboard.run(
      dashboardWith(
        "SELECT date_trunc('month', event_date) AS d, COUNT(*) AS c FROM analytics_events GROUP BY 1",
      ),
    );

    expect(mocks.upsertDashboard).toHaveBeenCalled();
  });
});
