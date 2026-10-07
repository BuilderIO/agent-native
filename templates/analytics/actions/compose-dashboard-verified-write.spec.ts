import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, { config: Record<string, unknown> }>();

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  upsertDashboardWithRetry: vi.fn(),
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
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
  upsertDashboardWithRetry: mocks.upsertDashboardWithRetry,
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

const agent = { userEmail: "alice@example.com", orgId: null, caller: "tool" };
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
  mocks.upsertDashboardWithRetry.mockImplementation(
    async (id: string, ctx: unknown, mutate: any) => {
      const existing = await mocks.getDashboard(id, ctx);
      const { kind, body } = await mutate(existing);
      await mocks.upsertDashboard(id, kind, body, ctx);
      return { ...existing, kind, config: body };
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
    expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
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
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });
});
