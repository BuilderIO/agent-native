import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for compose-dashboard. The metric catalog and the first-party SQL
 * validator run for real; only the store + collab layers are mocked so we can
 * assert on the assembled config without a database.
 */

interface SavedDashboard {
  config: Record<string, unknown>;
}

const store = new Map<string, SavedDashboard>();

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
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

const { default: composeDashboard } = await import("./compose-dashboard");

const LARGE_METRICS = [
  "total-signups",
  "signups-over-time",
  "signups-by-template",
  "sessions-by-app",
  "sessions-over-time",
  "signed-in-vs-anon",
  "total-template-clicks",
  "cli-copies-over-time",
  "pageviews-over-time",
  "top-visited-urls",
  "top-visited-clips",
  "one-day-retention-by-template",
  "seven-day-retention-by-template",
  "referred-signups-30d",
  "viral-signup-share-30d",
  "viral-coefficient-90d",
  "top-referrers",
  "share-funnel-30d",
  "activated-referrers-90d",
  "clip-share-signups-30d",
];

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mocks.hasCollabState.mockResolvedValue(false);
  // Read returns whatever is currently in the in-memory store (or null).
  mocks.getDashboard.mockImplementation(async (id: string) => {
    const saved = store.get(id);
    return saved ? { kind: "sql", config: saved.config } : null;
  });
  // Write captures the saved config so a subsequent read sees it.
  mocks.upsertDashboard.mockImplementation(
    async (id: string, _kind: string, config: Record<string, unknown>) => {
      store.set(id, { config });
      return {
        id,
        title: typeof config?.name === "string" ? config.name : id,
        archivedAt: null,
      };
    },
  );
});

describe("compose-dashboard", () => {
  it("builds a large dashboard (20 metrics) in one call with correct SQL", async () => {
    const result: any = await composeDashboard.run(
      {
        dashboardId: "big-compose",
        title: "Big",
        metrics: LARGE_METRICS,
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );

    // ONE store write, not one-per-panel.
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);

    expect(result.panelCount).toBe(LARGE_METRICS.length);
    expect(result.createdMetrics).toEqual(LARGE_METRICS);
    expect(result.unknownMetrics).toEqual([]);
    expect(result.invalidMetrics).toEqual([]);

    const saved = store.get("big-compose")!;
    const panels = saved.config.panels as Array<Record<string, unknown>>;
    expect(panels).toHaveLength(20);

    // Each panel has the canonical first-party shape.
    for (const panel of panels) {
      expect(panel.source).toBe("first-party");
      expect(typeof panel.sql).toBe("string");
      expect((panel.sql as string).length).toBeGreaterThan(0);
      expect(typeof panel.id).toBe("string");
      expect(typeof panel.title).toBe("string");
      expect(typeof panel.chartType).toBe("string");
    }

    // Spot-check verbatim catalog SQL came through.
    const totalSignups = panels.find((p) => p.id === "total-signups")!;
    expect(totalSignups.sql).toContain("SELECT COUNT(*) AS signups");
    expect(totalSignups.sql).toContain("{{timeRange}}");
    expect((totalSignups.config as { yKey?: string }).yKey).toBe("signups");
    const signupsByTemplate = panels.find(
      (p) => p.id === "signups-by-template",
    )!;
    expect(signupsByTemplate.chartType).toBe("bar");
    expect(signupsByTemplate.sql).toContain("GROUP BY COALESCE");
    expect(signupsByTemplate.sql).toContain("ORDER BY count DESC");
    expect(signupsByTemplate.sql).not.toContain("WITH RECURSIVE");
    expect(signupsByTemplate.config).toMatchObject({
      xKey: "template",
      yKey: "count",
    });
    const pageviews = panels.find((p) => p.id === "pageviews-over-time")!;
    expect(pageviews.sql).toContain("event_name = 'pageview'");
    expect(pageviews.sql).toContain("{{timeRange}}");
    expect(pageviews.sql).toContain("{{emailFilter}}");
    // Windowed metric retains its default 30d window when none requested.
    const referred = panels.find((p) => p.id === "referred-signups-30d")!;
    expect(referred.sql).toContain("interval '30 days'");
  });

  it("accepts a stringified JSON array of metrics (CLI/gateway shape)", async () => {
    const result: any = await composeDashboard.run(
      {
        dashboardId: "string-metrics",
        title: "Stringified",
        metrics: JSON.stringify([
          "total-signups",
          "signups-over-time",
          "sessions-by-app",
        ]),
      },
      { userEmail: "alice@example.com", orgId: null, caller: "cli" },
    );
    expect(result.panelCount).toBe(3);
    expect(result.createdMetrics).toEqual([
      "total-signups",
      "signups-over-time",
      "sessions-by-app",
    ]);
  });

  it("reports unknown metric keys and skips them (not fatal)", async () => {
    const result: any = await composeDashboard.run(
      {
        dashboardId: "with-unknown",
        metrics: [
          "total-signups",
          "made-up-metric",
          "sessions-by-app",
          "another-bogus-key",
        ],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );
    expect(result.panelCount).toBe(2);
    expect(result.createdMetrics).toEqual(["total-signups", "sessions-by-app"]);
    expect(result.unknownMetrics).toEqual([
      "made-up-metric",
      "another-bogus-key",
    ]);
    // Still saved the valid panels.
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
  });

  it("appends to an existing dashboard by default, skipping ids already present", async () => {
    // First compose creates the dashboard.
    await composeDashboard.run(
      {
        dashboardId: "growth",
        title: "Growth",
        metrics: ["total-signups", "signups-over-time"],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );
    expect((store.get("growth")!.config.panels as unknown[]).length).toBe(2);

    // Second compose appends new panels + skips the one already present.
    const result: any = await composeDashboard.run(
      {
        dashboardId: "growth",
        metrics: ["total-signups", "sessions-by-app", "signed-in-vs-anon"],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );

    expect(result.panelCount).toBe(4); // 2 existing + 2 new
    expect(result.skippedExistingIds).toEqual(["total-signups"]);
    const ids = (
      store.get("growth")!.config.panels as Array<{ id: string }>
    ).map((p) => p.id);
    expect(ids).toEqual([
      "total-signups",
      "signups-over-time",
      "sessions-by-app",
      "signed-in-vs-anon",
    ]);
    // Original name preserved on append.
    expect(store.get("growth")!.config.name).toBe("Growth");
  });

  it("overwrite=true replaces the whole config", async () => {
    await composeDashboard.run(
      {
        dashboardId: "replace-me",
        title: "First",
        metrics: ["total-signups", "signups-over-time", "sessions-by-app"],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );
    expect((store.get("replace-me")!.config.panels as unknown[]).length).toBe(
      3,
    );

    const result: any = await composeDashboard.run(
      {
        dashboardId: "replace-me",
        title: "Second",
        metrics: ["total-signups"],
        overwrite: true,
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );

    expect(result.panelCount).toBe(1);
    const panels = store.get("replace-me")!.config.panels as Array<{
      id: string;
    }>;
    expect(panels.map((p) => p.id)).toEqual(["total-signups"]);
    expect(store.get("replace-me")!.config.name).toBe("Second");
  });

  it("is idempotent on append: re-composing the same metrics adds nothing", async () => {
    await composeDashboard.run(
      {
        dashboardId: "idem",
        title: "Idem",
        metrics: ["total-signups", "sessions-by-app"],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );
    const result: any = await composeDashboard.run(
      {
        dashboardId: "idem",
        metrics: ["total-signups", "sessions-by-app"],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );
    expect(result.panelCount).toBe(2);
    expect(result.skippedExistingIds).toEqual([
      "total-signups",
      "sessions-by-app",
    ]);
    expect((store.get("idem")!.config.panels as unknown[]).length).toBe(2);
  });

  it("applies a per-metric window override to windowed SQL", async () => {
    await composeDashboard.run(
      {
        dashboardId: "windowed",
        title: "Windowed",
        metrics: [
          { metric: "referred-signups-30d", window: "90d" },
          { metric: "viral-coefficient-90d", window: "all" },
        ],
      },
      { userEmail: "alice@example.com", orgId: null, caller: "tool" },
    );
    const panels = store.get("windowed")!.config.panels as Array<
      Record<string, unknown>
    >;
    const referred = panels.find((p) => p.id === "referred-signups-30d")!;
    expect(referred.sql).toContain("interval '90 days'");
    expect(referred.sql).not.toContain("interval '30 days'");

    const k = panels.find((p) => p.id === "viral-coefficient-90d")!;
    // "all" window strips the time clause.
    expect(k.sql).not.toContain("interval '90 days'");
  });
});
