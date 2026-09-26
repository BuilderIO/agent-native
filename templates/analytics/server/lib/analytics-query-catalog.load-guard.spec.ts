import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summaries: [] as Array<Record<string, unknown>>,
  loadCalls: [] as string[][],
  dashboardCatalogEntries: [] as Array<{
    defaultDashboardId: string;
    name: string;
    description: string;
    buildConfig: () => Record<string, unknown>;
  }>,
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
  get dashboardCatalogEntries() {
    return state.dashboardCatalogEntries;
  },
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
    state.dashboardCatalogEntries = [];
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
        limit: 201,
      },
    );
    expect(results.searchedDashboardCount).toBe(30);
    expect(results.dashboardSearchTruncated).toBe(false);
    expect(results.dashboardSearchStatus).toBe("available");
    expect(state.loadCalls[0]).toHaveLength(24);
    expect(state.loadCalls[0]).toContain("dashboard-01");
    expect(state.loadCalls[0]).toContain("dashboard-30");
    expect(results.candidates[0]).toMatchObject({
      kind: "dashboard-panel",
      origin: "saved-dashboard",
      dashboardId: "dashboard-01",
      panelId: "revenue-panel",
      dashboardTitle: "Closed Won Revenue",
      favorite: true,
    });
    expect(state.listSettingsByPrefix).toHaveBeenCalledWith(
      "u:alice@example.com:data-dict-",
      { limit: 201 },
    );
    expect(state.getUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "favorites",
    );
    expect(state.listOrgSettings).not.toHaveBeenCalled();
  });

  it("reports and logs when dashboard summary search reaches its cap", async () => {
    state.summaries = Array.from({ length: 201 }, (_, index) => ({
      ...savedRevenueSummary(),
      id: `dashboard-${String(index + 1).padStart(3, "0")}`,
      name:
        index === 200
          ? "Closed Won Revenue"
          : `Unrelated dashboard ${index + 1}`,
      configName:
        index === 200
          ? "Closed Won Revenue"
          : `Unrelated dashboard ${index + 1}`,
      description: `Unrelated description ${index + 1}`,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await searchAnalyticsQueryCatalog({
      search: "closed won revenue",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
    });

    expect(result.searchedDashboardCount).toBe(200);
    expect(result.dashboardSearchTruncated).toBe(true);
    expect(result.dashboardSearchStatus).toBe("available");
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ dashboardId: "dashboard-201" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[analytics] Dashboard reference search truncated.",
      { searchedDashboardCount: 200, dashboardSearchTruncated: true },
    );
  });

  it("does not use a shipped template when a saved dashboard may be beyond the cap", async () => {
    state.summaries = Array.from({ length: 201 }, (_, index) => ({
      ...savedRevenueSummary(),
      id: `dashboard-${String(index + 1).padStart(3, "0")}`,
      name: `Unrelated dashboard ${index + 1}`,
      configName: `Unrelated dashboard ${index + 1}`,
      description: `Unrelated description ${index + 1}`,
    }));
    state.dashboardCatalogEntries = [
      {
        defaultDashboardId: "agent-native-templates-first-party",
        name: "Active Users",
        description: "Saved active users dashboard",
        buildConfig: () => ({
          name: "Active Users",
          panels: [
            {
              id: "active-users",
              title: "Active Users",
              source: "bigquery",
              sql: "SELECT COUNT(DISTINCT user_id) FROM events",
            },
          ],
        }),
      },
    ];

    const result = await searchAnalyticsQueryCatalog({
      search: "active users",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
    });

    expect(result.dashboardSearchTruncated).toBe(true);
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({
        origin: "dashboard-template",
        dashboardId: "agent-native-templates-first-party",
      }),
    );
  });

  it("bounds org and personal dictionary reads and reports truncation", async () => {
    state.listOrgSettings.mockResolvedValueOnce(
      Object.fromEntries(
        Array.from({ length: 201 }, (_, index) => [
          `data-dict-org-${String(index + 1).padStart(3, "0")}`,
          {
            id: `org-${index + 1}`,
            metric:
              index === 200 ? "Dictionary cap match" : `Org metric ${index}`,
          },
        ]),
      ),
    );
    state.userSettings = Array.from({ length: 201 }, (_, index) => ({
      key: `u:alice@example.com:data-dict-user-${String(index + 1).padStart(3, "0")}`,
      value: {
        id: `user-${index + 1}`,
        metric: index === 200 ? "Dictionary cap match" : `User metric ${index}`,
      },
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await searchAnalyticsQueryCatalog({
      search: "dictionary cap match",
      email: "alice@example.com",
      orgId: "org-analytics",
      limit: 6,
    });

    expect(state.listOrgSettings).toHaveBeenCalledWith(
      "org-analytics",
      "data-dict-",
      { limit: 201 },
    );
    expect(state.listSettingsByPrefix).toHaveBeenCalledWith(
      "u:alice@example.com:data-dict-",
      { limit: 201 },
    );
    expect(result.searchedDictionaryEntryCount).toBe(400);
    expect(result.dictionarySearchTruncated).toBe(true);
    expect(result.dictionarySearchStatus).toBe("available");
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ id: "org-201" }),
    );
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ id: "user-201" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[analytics] Data dictionary search truncated.",
      { searchedDictionaryEntryCount: 400, dictionarySearchTruncated: true },
    );
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

    expect(results.candidates).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "closed-won-revenue",
      }),
    );
    expect(results.dashboardSearchStatus).toBe("unavailable");
    expect(results.dictionarySearchStatus).toBe("available");
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

    expect(results.candidates).toContainEqual(
      expect.objectContaining({
        kind: "dashboard-panel",
        dashboardId: "dashboard-01",
        panelId: "revenue-panel",
      }),
    );
    expect(results.dictionarySearchStatus).toBe("unavailable");
  });

  it("reports partial dictionary availability when one scoped read fails", async () => {
    state.listOrgSettings.mockRejectedValueOnce(
      new Error("org dictionary unavailable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await searchAnalyticsQueryCatalog({
      search: "active users",
      email: "alice@example.com",
      orgId: "org-analytics",
      limit: 6,
    });

    expect(result.dictionarySearchStatus).toBe("partial");
  });

  it("stops before dashboard hydration when the request budget expires", async () => {
    let resolveSummaries!: (value: Array<Record<string, unknown>>) => void;
    state.listDashboardSummaries.mockImplementationOnce(
      () =>
        new Promise<Array<Record<string, unknown>>>((resolve) => {
          resolveSummaries = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = searchAnalyticsQueryCatalog({
      search: "closed won revenue",
      email: "alice@example.com",
      orgId: null,
      limit: 6,
      signal: controller.signal,
    });

    controller.abort();
    resolveSummaries([savedRevenueSummary()]);

    await expect(pending).rejects.toThrow();
    expect(state.loadDashboardCatalogDashboards).not.toHaveBeenCalled();
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

    expect(results.candidates).toContainEqual(
      expect.objectContaining({
        kind: "dashboard-panel",
        dashboardId: "dashboard-01",
        panelId: "revenue-panel",
      }),
    );
    expect(results.candidates[0]).not.toHaveProperty("favorite");
  });
});
