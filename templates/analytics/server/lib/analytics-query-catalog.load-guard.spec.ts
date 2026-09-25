import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summaries: [] as Array<Record<string, unknown>>,
  loadCalls: [] as string[][],
  userSettings: [] as Array<{
    key: string;
    value: Record<string, unknown>;
  }>,
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
  listSettingsByPrefix: vi.fn(async (_prefix: string) => state.userSettings),
  getUserSetting: vi.fn(async () => ({ ids: ["dashboard-01"] })),
  listOrgSettings: vi.fn(async () => ({})),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: state.getUserSetting,
  listOrgSettings: state.listOrgSettings,
  listSettingsByPrefix: state.listSettingsByPrefix,
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

function savedRevenueSummary() {
  return {
    id: "dashboard-01",
    kind: "sql",
    name: "Closed Won Revenue",
    description: "Revenue from closed-won deals",
    configName: "Closed Won Revenue",
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
}

describe("searchAnalyticsQueryCatalog", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    state.summaries = [];
    state.loadCalls = [];
    state.userSettings = [];
    state.listDashboardSummaries.mockClear();
    state.loadDashboardCatalogDashboards.mockClear();
    state.listSettingsByPrefix.mockClear();
    state.getUserSetting.mockClear();
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
        ...(index === 29
          ? {
              certification: {
                status: "certified",
                certifiedAt: "2026-08-03T00:00:00.000Z",
                certifiedBy: "admin@example.com",
                certifiedForUpdatedAt: "2026-08-02T00:00:00.000Z",
              },
            }
          : {}),
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
        limit: 200,
      },
    );
    expect(state.loadCalls[0]).toHaveLength(24);
    expect(state.loadCalls[0]).toContain("dashboard-01");
    expect(state.loadCalls[0]).toContain("dashboard-30");
    expect(results[0]).toMatchObject({
      kind: "dashboard-panel",
      origin: "saved-dashboard",
      dashboardId: "dashboard-01",
      panelId: "revenue-panel",
      dashboardTitle: "Closed Won Revenue",
      favorite: true,
    });
    expect(state.listSettingsByPrefix).toHaveBeenCalledWith(
      "u:alice@example.com:data-dict-",
    );
    expect(state.getUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "favorites",
    );
    expect(state.listOrgSettings).not.toHaveBeenCalled();
  });

  it("keeps dictionary results when dashboard summaries fail", async () => {
    state.listDashboardSummaries.mockRejectedValueOnce(
      new Error("dashboard summaries unavailable"),
    );
    state.userSettings = [
      {
        key: "u:alice@example.com:data-dict-closed-won-revenue",
        value: {
          id: "closed-won-revenue",
          metric: "Closed Won Revenue",
          definition: "Revenue from closed-won deals",
          approved: true,
        },
      },
    ];
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await searchAnalyticsQueryCatalog({
      search: "closed won revenue",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "closed-won-revenue",
      }),
    );
  });

  it("keeps dashboard results when the dictionary lookup fails", async () => {
    state.summaries = [savedRevenueSummary()];
    state.listSettingsByPrefix.mockRejectedValueOnce(
      new Error("dictionary unavailable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await searchAnalyticsQueryCatalog({
      search: "closed won revenue",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "dashboard-panel",
        dashboardId: "dashboard-01",
        panelId: "revenue-panel",
      }),
    );
  });

  it("keeps dashboard results when favorite settings fail", async () => {
    state.summaries = [savedRevenueSummary()];
    state.getUserSetting.mockRejectedValueOnce(
      new Error("favorites unavailable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await searchAnalyticsQueryCatalog({
      search: "closed won revenue",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "dashboard-panel",
        dashboardId: "dashboard-01",
        panelId: "revenue-panel",
      }),
    );
    expect(results[0]).not.toHaveProperty("favorite");
  });
});
