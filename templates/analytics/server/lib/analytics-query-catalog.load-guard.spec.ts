import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summaries: [] as Array<Record<string, unknown>>,
  loadCalls: [] as string[][],
  listDashboardSummaries: vi.fn(async () => state.summaries),
  loadDashboardCatalogDashboards: vi.fn(
    async (_ctx: { email: string; orgId: string | null }, ids: string[]) => {
      state.loadCalls.push([...ids]);
      return ids.map((id) =>
        id === "dashboard-01"
          ? {
              id,
              kind: "sql" as const,
              title: "Closed Won Revenue",
              description: "Revenue from closed-won deals",
              config: {
                name: "Closed Won Revenue",
                description: "Revenue from closed-won deals",
                panels: [
                  {
                    id: "revenue-panel",
                    title: "Closed Won Revenue",
                    source: "bigquery",
                    sql: "SELECT revenue FROM deals",
                  },
                ],
              },
            }
          : {
              id,
              kind: "sql" as const,
              title: `Dashboard ${id}`,
              description: `Description ${id}`,
              config: { name: `Dashboard ${id}`, panels: [] },
            },
      );
    },
  ),
  getAllSettings: vi.fn(async () => ({})),
  listOrgSettings: vi.fn(async () => ({})),
}));

vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: state.getAllSettings,
  listOrgSettings: state.listOrgSettings,
}));

vi.mock("./dashboard-catalog", () => ({
  dashboardCatalogEntries: [],
}));

vi.mock("./dashboards-store", () => ({
  listDashboardSummaries: state.listDashboardSummaries,
  loadDashboardCatalogDashboards: state.loadDashboardCatalogDashboards,
}));

const { searchAnalyticsQueryCatalog } =
  await import("./analytics-query-catalog.js");

describe("searchAnalyticsQueryCatalog", () => {
  beforeEach(() => {
    state.summaries = [];
    state.loadCalls = [];
    state.listDashboardSummaries.mockClear();
    state.loadDashboardCatalogDashboards.mockClear();
    state.getAllSettings.mockClear();
    state.listOrgSettings.mockClear();
  });

  it("shortlists dashboards from metadata before hydrating explicit configs", async () => {
    state.summaries = Array.from({ length: 30 }, (_, index) => {
      const number = index + 1;
      return {
        id: `dashboard-${String(number).padStart(2, "0")}`,
        kind: "sql",
        name: index === 0 ? "Closed Won Revenue" : `Misc dashboard ${number}`,
        description:
          index === 0
            ? "Revenue from closed-won deals"
            : `Unrelated dashboard ${number}`,
        configName:
          index === 0 ? "Closed Won Revenue" : `Misc dashboard ${number}`,
        catalogTemplateId: null,
        demoId: null,
        parentId: null,
        ownerEmail: "alice@example.com",
        orgId: null,
        visibility: "private",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archivedAt: null,
        hiddenAt: null,
        hiddenBy: null,
      };
    });

    const results = await searchAnalyticsQueryCatalog({
      search: "closed won revenue",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
    });

    expect(state.listDashboardSummaries).toHaveBeenCalledWith(
      { email: "alice@example.com", orgId: null },
      {
        kind: "sql",
        archived: "active",
        hidden: "visible",
        includeCatalogMetadata: true,
      },
    );
    expect(state.loadCalls[0]).toHaveLength(24);
    expect(state.loadCalls[0]).toContain("dashboard-01");
    expect(state.loadCalls[0]).not.toContain("dashboard-30");
    expect(results[0]).toMatchObject({
      kind: "dashboard-panel",
      origin: "saved-dashboard",
      dashboardId: "dashboard-01",
      panelId: "revenue-panel",
      dashboardTitle: "Closed Won Revenue",
    });
    expect(state.getAllSettings).toHaveBeenCalledTimes(1);
    expect(state.listOrgSettings).not.toHaveBeenCalled();
  });
});
