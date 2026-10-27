import { beforeEach, describe, expect, it, vi } from "vitest";

import { sameJsonValue } from "./dashboard-mutation-api";

const store = new Map<string, { config: Record<string, unknown> }>();

const mocks = vi.hoisted(() => ({
  assertDashboardEditable: vi.fn(async (): Promise<void> => undefined),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  upsertDashboardWithRetryOutcome: vi.fn(),
  resolvePanel: vi.fn(),
}));

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  embedApp: vi.fn((value: unknown) => value),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  buildDeepLink: () => "/analytics/adhoc",
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getCredentialContext: () => ({
      userEmail: "alice@example.com",
      orgId: null,
    }),
  }),
);
vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(async () => undefined),
  hasCollabState: vi.fn(async () => false),
  seedFromText: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/dashboards-store", () => ({
  assertDashboardEditable: mocks.assertDashboardEditable,
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
  upsertDashboardWithRetryOutcome: mocks.upsertDashboardWithRetryOutcome,
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));
// The real validator opens the local PGlite directory, which another test
// worker may hold; this spec is about verification, not SQL validation.
vi.mock("../server/lib/first-party-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/first-party-analytics.js")
  >()),
  validateFirstPartyAnalyticsSqlForScope: vi.fn(async () => undefined),
}));

const { default: composeDashboard } = await import("./compose-dashboard");
const { buildPanel, listMetricKeys } =
  await import("../server/lib/first-party-metric-catalog");

const agent = { userEmail: "alice@example.com", orgId: null, caller: "tool" };

/** Rows that satisfy every key a catalog panel's config binds. */
function rowsBoundBy(config: Record<string, any>): Record<string, unknown>[] {
  const pivot = config.pivot as Record<string, string> | undefined;
  const dateKeys = new Set([config.xKey, pivot?.xKey]);
  const keys = new Set<string>(
    [
      config.xKey,
      config.yKey,
      ...(config.yKeys ?? []),
      pivot?.xKey,
      pivot?.seriesKey,
      pivot?.valueKey,
      ...(config.columns ?? []).flatMap((col: any) => [col.key, col.linkKey]),
    ].filter(Boolean),
  );
  if (keys.size === 0) keys.add("count");
  return ["2026-09-01", "2026-09-02"].map((day) =>
    Object.fromEntries(
      Array.from(keys, (key) => [
        key,
        dateKeys.has(key) ? day : key === pivot?.seriesKey ? "mail" : 3,
      ]),
    ),
  );
}
const LONG_ROWS = [
  { date: "2026-09-01", template: "mail", count: 3 },
  { date: "2026-09-01", template: "clips", count: 4 },
];

function result(rows: Record<string, unknown>[]) {
  return {
    rows,
    schema: Object.keys(rows[0] ?? {}).map((name) => ({
      name,
      type: "STRING",
    })),
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mocks.assertDashboardEditable.mockResolvedValue(undefined);
  mocks.resolvePanel.mockResolvedValue(result(LONG_ROWS));
  mocks.getDashboard.mockImplementation(async (id: string) => {
    const saved = store.get(id);
    return saved ? { kind: "sql", config: saved.config } : null;
  });
  mocks.upsertDashboard.mockImplementation(
    async (id: string, _kind: string, config: Record<string, unknown>) => {
      store.set(id, { config });
      return { id, title: id, archivedAt: null };
    },
  );
  mocks.upsertDashboardWithRetryOutcome.mockImplementation(
    async (id: string, ctx: unknown, mutate: any) => {
      const existing = await mocks.getDashboard(id, ctx);
      const { kind, body } = await mutate(existing);
      const didWrite = !sameJsonValue(existing.config, body);
      await mocks.upsertDashboard(id, kind, body, ctx);
      return { dashboard: { ...existing, kind, config: body }, didWrite };
    },
  );
});

describe("compose-dashboard verified writes", () => {
  it("saves composed panels that render and reports the proof", async () => {
    const composed: any = await composeDashboard.run(
      { dashboardId: "growth", metrics: ["signups-over-time"] },
      agent,
    );

    expect(composed).toMatchObject({ saved: true, verified: true });
    expect(composed.verification).toEqual([
      expect.objectContaining({
        panelId: "signups-over-time",
        status: "ok",
        columns: ["date", "template", "count"],
      }),
    ]);
    expect(composed.message).toContain("Verified: Signups Over Time");
    expect(composed._receipt).toMatchObject({
      changed: true,
      verified: true,
      subject: "growth",
      summary: expect.stringContaining('Saved "growth" with 1 panel(s)'),
      checks: [{ id: "signups-over-time", ok: true }],
    });
    expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
  });

  // The agent cannot edit a catalog panel's config, so no catalog metric may
  // be refused by a rule about config keys.
  it.each(listMetricKeys())(
    "composes the catalog metric %s through the gate",
    async (metric) => {
      mocks.resolvePanel.mockResolvedValue(
        result(rowsBoundBy(buildPanel(metric)!.config)),
      );

      const composed: any = await composeDashboard.run(
        { dashboardId: "growth", metrics: [metric] },
        agent,
      );

      expect(composed).toMatchObject({ saved: true, verified: true });
      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["appends", {}],
    ["refreshes", { refreshExisting: true }],
  ])(
    "%s a catalog panel on an existing dashboard without the key rules",
    async (_, extra) => {
      store.set("growth", {
        config: {
          name: "Growth",
          panels: [
            {
              ...buildPanel("sessions-by-app")!,
              sql: "SELECT 'mail' AS app, 1 AS count",
              config: { xKey: "app", yKey: "count" },
            },
          ],
        },
      });
      const metrics = extra.refreshExisting
        ? ["sessions-by-app"]
        : ["activation-funnel"];
      mocks.resolvePanel.mockResolvedValue(
        result(rowsBoundBy(buildPanel(metrics[0])!.config)),
      );

      const composed: any = await composeDashboard.run(
        { dashboardId: "growth", metrics, ...extra },
        agent,
      );

      expect(composed).toMatchObject({ saved: true, verified: true });
      expect(composed.verification).toEqual([
        expect.objectContaining({ panelId: metrics[0], status: "ok" }),
      ]);
    },
  );

  it("still gates a catalog panel on how it renders", async () => {
    mocks.resolvePanel.mockResolvedValue(
      result([{ template: "mail", count: 3 }]),
    );

    await expect(
      composeDashboard.run(
        { dashboardId: "growth", metrics: ["sessions-by-app"] },
        agent,
      ),
    ).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
      message: expect.stringContaining('panel "sessions-by-app"'),
    });
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("says verified:false in the receipt for a saved empty panel", async () => {
    mocks.resolvePanel.mockResolvedValue({
      rows: [],
      schema: ["date", "template", "count"].map((name) => ({
        name,
        type: "STRING",
      })),
    });

    const composed: any = await composeDashboard.run(
      {
        dashboardId: "growth",
        metrics: ["signups-over-time"],
        allowEmptyResult: true,
      },
      agent,
    );

    expect(composed._receipt).toMatchObject({
      changed: true,
      verified: false,
      subject: "growth",
    });
  });

  it("emits no receipt when the append changed nothing", async () => {
    await composeDashboard.run(
      { dashboardId: "growth", metrics: ["signups-over-time"] },
      agent,
    );
    mocks.upsertDashboard.mockClear();

    const again: any = await composeDashboard.run(
      { dashboardId: "growth", metrics: ["signups-over-time"] },
      agent,
    );

    expect(again.changed).toBe(false);
    expect(again._receipt).toBeUndefined();
  });

  describe("edit permission comes before any panel SQL runs", () => {
    const viewerError = () =>
      Object.assign(
        new Error("Requires editor role on dashboard growth (have viewer)"),
        { statusCode: 403 },
      );

    it.each([
      ["an append", {}],
      ["an overwrite", { overwrite: true }],
    ])("refuses a viewer on %s without executing a panel", async (_, extra) => {
      store.set("growth", { config: { name: "Growth", panels: [] } });
      mocks.assertDashboardEditable.mockRejectedValue(viewerError());

      await expect(
        composeDashboard.run(
          { dashboardId: "growth", metrics: ["signups-over-time"], ...extra },
          agent,
        ),
      ).rejects.toMatchObject({
        errorCode: "dashboard_forbidden",
        statusCode: 403,
      });
      expect(mocks.resolvePanel).not.toHaveBeenCalled();
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("lets anyone create a dashboard that does not exist yet", async () => {
      mocks.assertDashboardEditable.mockRejectedValue(viewerError());

      const composed: any = await composeDashboard.run(
        { dashboardId: "brand-new", metrics: ["signups-over-time"] },
        agent,
      );

      expect(composed.saved).toBe(true);
      expect(mocks.assertDashboardEditable).not.toHaveBeenCalled();
    });
  });

  it("refuses a caller-supplied chart type the renderer does not know", async () => {
    await expect(
      composeDashboard.run(
        {
          dashboardId: "growth",
          metrics: [{ metric: "signups-over-time", chartType: "lien" }],
        },
        agent,
      ),
    ).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
      message: expect.stringContaining("Did you mean 'line'?"),
    });
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("refuses a panel whose result no longer binds to its config, in the append path too", async () => {
    store.set("growth", { config: { name: "Growth", panels: [] } });
    mocks.resolvePanel.mockResolvedValue(
      result([{ date: "2026-09-01", count: 3 }]),
    );

    await expect(
      composeDashboard.run(
        { dashboardId: "growth", metrics: ["signups-over-time"] },
        agent,
      ),
    ).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
      message: expect.stringContaining('panel "signups-over-time"'),
    });
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("refuses an empty panel unless allowEmptyResult, then saves it as unverified", async () => {
    mocks.resolvePanel.mockResolvedValue({
      rows: [],
      schema: ["date", "template", "count"].map((name) => ({
        name,
        type: "STRING",
      })),
    });
    const args = { dashboardId: "growth", metrics: ["signups-over-time"] };

    await expect(composeDashboard.run(args, agent)).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();

    const composed: any = await composeDashboard.run(
      { ...args, allowEmptyResult: true },
      agent,
    );

    expect(composed).toMatchObject({ saved: true, verified: false });
    expect(composed.nextStep).toContain("inspect-dashboard-panel");
    expect(composed.message).toMatch(/^SAVED BUT NOT VERIFIED:/);
  });

  it("does not verify calls that are not from an agent", async () => {
    const composed: any = await composeDashboard.run(
      {
        dashboardId: "growth",
        metrics: [{ metric: "signups-over-time", chartType: "lien" }],
      },
      { ...agent, caller: "cli" },
    );

    expect(composed.saved).toBe(true);
    expect(composed.verified).toBeUndefined();
    expect(composed._receipt).toBeUndefined();
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });
});
