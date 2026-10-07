import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({
    archivedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
  })),
  upsertDashboardWithRetry: vi.fn(),
  resolvePanel: vi.fn(),
}));

function defaultUpsertDashboardWithRetry(
  id: string,
  ctx: unknown,
  mutate: (existing: any) => Promise<any> | any,
) {
  return (async () => {
    const existing = await mocks.getDashboard(id, ctx);
    const { kind, body } = await mutate(existing);
    await mocks.upsertDashboard(id, kind, body, ctx);
    return { ...existing, kind, config: body };
  })();
}

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
  DashboardConflictError: class DashboardConflictError extends Error {},
}));
vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: vi.fn(async () => null),
  dryRunQuerySchema: vi.fn(async () => ({ error: null })),
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));

const { default: updateDashboard } = await import("./update-dashboard");

const agent = { caller: "tool" } as never;
const frontend = { caller: "frontend" } as never;
const LONG_ROWS = [
  { week: "2026-09-01", app: "mail", n: 10 },
  { week: "2026-09-08", app: "mail", n: 11 },
];
const WIDE_ROWS = [{ week: "2026-09-01", mail: 10, clips: 20 }];

function result(rows: Record<string, unknown>[]) {
  return {
    rows,
    schema: Object.keys(rows[0] ?? {}).map((name) => ({
      name,
      type: "STRING",
    })),
  };
}

function pivotPanel(overrides: Record<string, unknown> = {}) {
  return {
    id: "by-app",
    title: "By app",
    source: "bigquery",
    chartType: "line",
    width: 2,
    sql: "SELECT week, app, n FROM t",
    config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } },
    ...overrides,
  };
}

function dashboard(panels: Record<string, unknown>[]) {
  return { name: "Growth", panels };
}

beforeEach(() => {
  mocks.getDashboard.mockReset();
  mocks.getDashboard.mockResolvedValue({
    kind: "sql",
    config: dashboard([pivotPanel()]),
  });
  mocks.upsertDashboard.mockClear();
  mocks.upsertDashboardWithRetry.mockReset();
  mocks.upsertDashboardWithRetry.mockImplementation(
    defaultUpsertDashboardWithRetry,
  );
  mocks.resolvePanel.mockReset();
  mocks.resolvePanel.mockResolvedValue(result(LONG_ROWS));
});

describe("update-dashboard verified writes", () => {
  describe("config replace", () => {
    const wideConfig = () =>
      dashboard([pivotPanel({ sql: "SELECT week, mail, clips FROM t" })]);

    it("refuses an agent save whose panel would not render and writes nothing", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      await expect(
        updateDashboard.run(
          { dashboardId: "growth", config: wideConfig() },
          agent,
        ),
      ).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
        statusCode: 422,
        message: expect.stringContaining('panel "by-app"'),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("keeps UI saves on today's behavior", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      const saved: any = await updateDashboard.run(
        { dashboardId: "growth", config: wideConfig() },
        frontend,
      );

      expect(saved.verified).toBeUndefined();
      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
      expect(mocks.resolvePanel).not.toHaveBeenCalled();
    });

    it("only runs panels the new config changed", async () => {
      const unchanged = pivotPanel({ id: "other", title: "Other" });
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: dashboard([pivotPanel(), unchanged]),
      });

      const saved: any = await updateDashboard.run(
        {
          dashboardId: "growth",
          config: dashboard([
            pivotPanel({ sql: "SELECT week, app, n FROM t LIMIT 5" }),
            unchanged,
          ]),
        },
        agent,
      );

      expect(saved).toMatchObject({ verified: true });
      expect(saved.verification).toEqual([
        expect.objectContaining({ panelId: "by-app", rowCount: 2 }),
      ]);
      expect(mocks.resolvePanel).toHaveBeenCalledTimes(1);
    });

    it("saves an empty panel only with allowEmptyResult, reporting verified:false", async () => {
      mocks.resolvePanel.mockResolvedValue({
        rows: [],
        schema: ["week", "app", "n"].map((name) => ({ name, type: "STRING" })),
      });
      const args = {
        dashboardId: "growth",
        config: dashboard([pivotPanel({ sql: "SELECT week, app, n FROM e" })]),
      };

      await expect(updateDashboard.run(args, agent)).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
      });
      const saved: any = await updateDashboard.run(
        { ...args, allowEmptyResult: true },
        agent,
      );

      expect(saved).toMatchObject({ verified: false });
      expect(saved.unverified[0]).toMatchObject({ status: "empty" });
      expect(saved.message).toMatch(/^SAVED BUT NOT VERIFIED:/);
    });
  });

  describe("ops", () => {
    const setSql = (sql: string) => ({
      dashboardId: "growth",
      ops: [{ op: "set" as const, path: "/panels/0/sql", value: sql }],
    });

    it("refuses an agent op that blanks a pivoted panel, against the pre-edit config", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      await expect(
        updateDashboard.run(setSql("SELECT week, mail, clips FROM t"), agent),
      ).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
        message: expect.stringContaining("Remove config.pivot"),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("returns the proof when the edited panel renders", async () => {
      const saved: any = await updateDashboard.run(
        setSql("SELECT week, app, n FROM t LIMIT 9"),
        agent,
      );

      expect(saved).toMatchObject({ verified: true });
      expect(saved.message).toContain("Verified: By app -> 2 rows");
    });

    it("executes nothing for a title edit", async () => {
      const saved: any = await updateDashboard.run(
        {
          dashboardId: "growth",
          ops: [{ op: "set", path: "/panels/0/title", value: "Renamed" }],
        },
        agent,
      );

      expect(saved.verified).toBeNull();
      expect(mocks.resolvePanel).not.toHaveBeenCalled();
    });
  });

  describe("legacy invalid width ratchet", () => {
    const legacy = () =>
      pivotPanel({ id: "legacy", title: "Legacy chart", width: "wide" });
    const withLegacy = () =>
      dashboard([pivotPanel({ id: "other", title: "Other" }), legacy()]);

    beforeEach(() => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: withLegacy(),
      });
    });

    it.each([
      ["agent", agent],
      ["frontend", frontend],
    ])("lets a %s ops edit of another panel through", async (_, caller) => {
      await updateDashboard.run(
        {
          dashboardId: "growth",
          ops: [{ op: "set", path: "/panels/0/title", value: "Renamed" }],
        },
        caller,
      );

      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
    });

    it("rejects an ops edit of the legacy panel itself, naming id, title, and value", async () => {
      await expect(
        updateDashboard.run(
          {
            dashboardId: "growth",
            ops: [{ op: "set", path: "/panels/1/title", value: "Legacy v2" }],
          },
          frontend,
        ),
      ).rejects.toMatchObject({
        errorCode: "dashboard_invalid_panel",
        message: expect.stringContaining(
          'panel "legacy" ("Legacy v2") width is "wide"',
        ),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("lets a panelOrder reorder through", async () => {
      await updateDashboard.run(
        { dashboardId: "growth", panelOrder: ["legacy"] },
        frontend,
      );

      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
    });

    it("lets a UI save of a different panel through", async () => {
      const next = withLegacy();
      next.panels[0].title = "Renamed";

      await updateDashboard.run(
        { dashboardId: "growth", config: next },
        frontend,
      );

      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
    });

    it("rejects a UI save that changes the legacy panel without repairing it", async () => {
      const next = withLegacy();
      next.panels[1].title = "Legacy v2";

      await expect(
        updateDashboard.run({ dashboardId: "growth", config: next }, frontend),
      ).rejects.toMatchObject({
        errorCode: "dashboard_invalid_panel",
        message: expect.stringContaining(
          'panel "legacy" ("Legacy v2") width is "wide"',
        ),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("rejects a new panel with an invalid width", async () => {
      const next = withLegacy();
      next.panels.push(
        pivotPanel({ id: "fresh", title: "Fresh chart", width: 9 }),
      );

      await expect(
        updateDashboard.run({ dashboardId: "growth", config: next }, frontend),
      ).rejects.toMatchObject({
        errorCode: "dashboard_invalid_panel",
        message: expect.stringContaining(
          'panel "fresh" ("Fresh chart") width is 9',
        ),
      });
    });

    it("validates every panel of a brand-new dashboard", async () => {
      mocks.getDashboard.mockResolvedValue(null);

      await expect(
        updateDashboard.run(
          { dashboardId: "fresh-board", config: withLegacy() },
          frontend,
        ),
      ).rejects.toMatchObject({
        errorCode: "dashboard_invalid_panel",
        message: expect.stringContaining(
          'panel "legacy" ("Legacy chart") width is "wide"',
        ),
      });
    });
  });
});
