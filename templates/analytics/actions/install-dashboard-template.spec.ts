import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async (id: string, kind: string, config: any) => ({
    id,
    kind,
    title: typeof config?.name === "string" ? config.name : id,
    config,
    archivedAt: null,
  })),
  upsertDashboardWithRetry: vi.fn(),
  getDashboardCatalogEntry: vi.fn(),
  cloneDashboardConfig: vi.fn(),
  listDashboardCatalog: vi.fn(async () => []),
  applyCatalogMetadata: vi.fn((_entry: unknown, config: unknown) => config),
  generateDashboardId: vi.fn(() => "generated-id"),
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
  upsertDashboardWithRetry: mocks.upsertDashboardWithRetry,
}));

vi.mock("../server/lib/dashboard-catalog", () => ({
  getDashboardCatalogEntry: mocks.getDashboardCatalogEntry,
  cloneDashboardConfig: mocks.cloneDashboardConfig,
  listDashboardCatalog: mocks.listDashboardCatalog,
  applyCatalogMetadata: mocks.applyCatalogMetadata,
  generateDashboardId: mocks.generateDashboardId,
}));

const { default: installDashboardTemplate } =
  await import("./install-dashboard-template");

const ENTRY = { id: "skills-cli-funnel", name: "Skills CLI Funnel" };

/**
 * Default passthrough: re-read via the mocked `getDashboard`, run the
 * action's merge callback once against it, then forward to the mocked
 * `upsertDashboard` (preserving every existing `.mock.calls` assertion
 * below). Individual tests override this with `mockImplementationOnce` to
 * simulate a lost race and prove the merge recomputes from fresh state on
 * retry.
 */
function defaultUpsertDashboardWithRetry(
  id: string,
  ctx: unknown,
  mutate: (existing: any) =>
    | Promise<{ kind: string; body: unknown }>
    | {
        kind: string;
        body: unknown;
      },
) {
  return (async () => {
    const existing = await mocks.getDashboard(id, ctx);
    if (!existing) {
      throw new Error(
        `dashboard "${id}" not found (or you don't have access).`,
      );
    }
    const { kind, body } = await mutate(existing);
    return mocks.upsertDashboard(id, kind, body, ctx);
  })();
}

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

describe("install-dashboard-template mergePanels", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.upsertDashboardWithRetry.mockReset();
    mocks.upsertDashboardWithRetry.mockImplementation(
      defaultUpsertDashboardWithRetry,
    );
    mocks.getDashboardCatalogEntry.mockReset();
    mocks.cloneDashboardConfig.mockReset();
    mocks.listDashboardCatalog.mockClear();
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();

    mocks.getDashboardCatalogEntry.mockReturnValue(ENTRY);
  });

  it("appends only template panels whose id is not already present, preserving existing panels + order", async () => {
    // Existing dashboard already has p1 + p2 (in that order) plus a custom panel.
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      title: "My Dashboard",
      config: {
        name: "My Dashboard",
        panels: [panel("p1"), panel("custom"), panel("p2")],
      },
    });
    // Template seed has p1 (dupe), p3, p4 (new).
    mocks.cloneDashboardConfig.mockReturnValue({
      name: "Skills CLI Funnel",
      panels: [panel("p1"), panel("p3"), panel("p4")],
    });

    const result: any = await installDashboardTemplate.run({
      templateId: "skills-cli-funnel",
      dashboardId: "my-dashboard",
      mergePanels: true,
    });

    expect(result.merged).toBe(true);
    expect(result.addedPanelIds).toEqual(["p3", "p4"]);
    expect(result.skippedExistingIds).toEqual(["p1"]);
    expect(result.panelCount).toBe(5);
    expect(result.dashboardId).toBe("my-dashboard");

    // Saved once, with existing panels first (in original order) then appended.
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const savedConfig = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(savedConfig.panels.map((p) => p.id)).toEqual([
      "p1",
      "custom",
      "p2",
      "p3",
      "p4",
    ]);
  });

  it("does not save when every template panel id already exists, and reports panelCount", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      title: "My Dashboard",
      config: {
        name: "My Dashboard",
        panels: [panel("p1"), panel("p2")],
      },
    });
    mocks.cloneDashboardConfig.mockReturnValue({
      name: "Skills CLI Funnel",
      panels: [panel("p1"), panel("p2")],
    });

    const result: any = await installDashboardTemplate.run({
      templateId: "skills-cli-funnel",
      dashboardId: "my-dashboard",
      mergePanels: true,
    });

    expect(result.merged).toBe(true);
    expect(result.addedPanelIds).toEqual([]);
    expect(result.skippedExistingIds).toEqual(["p1", "p2"]);
    expect(result.panelCount).toBe(2);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("merges template filters when appending panels to an existing dashboard", async () => {
    const regionFilter = { id: "region", label: "Region", type: "text" };
    const timeRangeFilter = {
      id: "timeRange",
      label: "Time range",
      type: "select",
      default: "90d",
    };
    const emailFilter = {
      id: "emailFilter",
      label: "Email",
      type: "select",
      default: "all",
    };
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      title: "My Dashboard",
      config: {
        name: "My Dashboard",
        filters: [regionFilter],
        panels: [panel("p1")],
      },
    });
    mocks.cloneDashboardConfig.mockReturnValue({
      name: "Skills CLI Funnel",
      filters: [timeRangeFilter, emailFilter],
      panels: [panel("p2")],
    });

    const result: any = await installDashboardTemplate.run({
      templateId: "skills-cli-funnel",
      dashboardId: "my-dashboard",
      mergePanels: true,
    });

    expect(result.addedPanelIds).toEqual(["p2"]);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const savedConfig = mocks.upsertDashboard.mock.calls[0][2] as {
      filters: unknown[];
    };
    expect(savedConfig.filters).toEqual([
      regionFilter,
      timeRangeFilter,
      emailFilter,
    ]);
  });

  it("saves when mergePanels only needs to heal missing template filters", async () => {
    const timeRangeFilter = {
      id: "timeRange",
      label: "Time range",
      type: "select",
      default: "90d",
    };
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      title: "My Dashboard",
      config: {
        name: "My Dashboard",
        panels: [panel("p1")],
      },
    });
    mocks.cloneDashboardConfig.mockReturnValue({
      name: "Skills CLI Funnel",
      filters: [timeRangeFilter],
      panels: [panel("p1")],
    });

    const result: any = await installDashboardTemplate.run({
      templateId: "skills-cli-funnel",
      dashboardId: "my-dashboard",
      mergePanels: true,
    });

    expect(result.addedPanelIds).toEqual([]);
    expect(result.skippedExistingIds).toEqual(["p1"]);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const savedConfig = mocks.upsertDashboard.mock.calls[0][2] as {
      filters: unknown[];
    };
    expect(savedConfig.filters).toEqual([timeRangeFilter]);
  });

  it("requires dashboardId when mergePanels is true", async () => {
    await expect(
      installDashboardTemplate.run({
        templateId: "skills-cli-funnel",
        mergePanels: true,
      }),
    ).rejects.toThrow(/mergePanels.*requires dashboardId/i);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("errors (non-destructively) when the target dashboard does not exist", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    await expect(
      installDashboardTemplate.run({
        templateId: "skills-cli-funnel",
        dashboardId: "missing",
        mergePanels: true,
      }),
    ).rejects.toThrow(/not found/i);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("recomputes the merge against fresh state on retry so a concurrent writer's panel is never dropped", async () => {
    // Simulates two interleaved writers racing on the same dashboard: this
    // mergePanels call wants to add template panel "p3", but its first
    // fenced write is lost because a concurrent writer already saved a
    // different panel ("writer-a") in between. A correct retry re-reads that
    // winning save and re-merges "p3" on top of it, so both panels land
    // instead of the second writer clobbering the first's insert.
    const beforeConcurrentWrite = {
      kind: "sql",
      title: "My Dashboard",
      config: { name: "My Dashboard", panels: [panel("p1")] },
    };
    const afterConcurrentWrite = {
      kind: "sql",
      title: "My Dashboard",
      config: {
        name: "My Dashboard",
        panels: [panel("p1"), panel("writer-a")],
      },
    };

    mocks.getDashboard.mockResolvedValue(beforeConcurrentWrite);
    mocks.cloneDashboardConfig.mockReturnValue({
      name: "Skills CLI Funnel",
      panels: [panel("p1"), panel("p3")],
    });

    let mutateCallCount = 0;
    mocks.upsertDashboardWithRetry.mockImplementationOnce(
      async (id: string, ctx: unknown, mutate: (existing: any) => any) => {
        mutateCallCount += 1;
        await mutate(beforeConcurrentWrite); // attempt 1: lost to the race
        mutateCallCount += 1;
        const { kind, body } = await mutate(afterConcurrentWrite); // retry
        return mocks.upsertDashboard(id, kind, body, ctx);
      },
    );

    const result: any = await installDashboardTemplate.run({
      templateId: "skills-cli-funnel",
      dashboardId: "my-dashboard",
      mergePanels: true,
    });

    expect(mutateCallCount).toBe(2);
    expect(result.addedPanelIds).toEqual(["p3"]);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual(["p1", "writer-a", "p3"]);
  });

  it("leaves normal install (no mergePanels) untouched", async () => {
    // No existing install, no existing dashboard at id → fresh install.
    mocks.listDashboardCatalog.mockResolvedValue([]);
    mocks.getDashboard.mockResolvedValue(null);
    mocks.cloneDashboardConfig.mockReturnValue({
      name: "Skills CLI Funnel",
      panels: [panel("p1"), panel("p2")],
    });

    const result: any = await installDashboardTemplate.run({
      templateId: "skills-cli-funnel",
    });

    expect(result.merged).toBeUndefined();
    expect(result.alreadyInstalled).toBe(false);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
  });
});
