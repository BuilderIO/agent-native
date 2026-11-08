import { analyticsPanelCaptureSchema } from "@agent-native/core/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  loadBuiltin: vi.fn(),
  builtinVisibility: vi.fn(),
  resolvePanel: vi.fn(),
  listKeyDateSets: vi.fn(),
}));

vi.mock("./open-dashboard", () => ({
  openDashboard: async (id: string, scope: unknown) => {
    const saved = await mocks.getDashboard(id, scope);
    if (saved) return { saved };
    const config = mocks.loadBuiltin(id);
    return config ? { builtin: { id, title: id, version: 1, config } } : null;
  },
  openedDashboardVisibility: async (opened: {
    saved?: { visibility: string };
  }) => opened.saved?.visibility ?? mocks.builtinVisibility(),
}));
vi.mock("./dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));
vi.mock("./key-dates-store", () => ({
  listKeyDateSets: mocks.listKeyDateSets,
}));

const {
  captureDashboardPanel,
  dashboardPanelStatus,
  fitCaptureToChars,
  PanelCaptureError,
  panelFingerprint,
  roundCaptureNumber,
} = await import("./panel-capture");

const TIME_RANGE = {
  id: "timeRange",
  type: "select",
  label: "Range",
  default: "30d",
  options: [
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
  ],
};

const SIGNUPS = {
  id: "signups",
  title: "Signups",
  source: "bigquery",
  chartType: "line",
  width: 2,
  sql: "SELECT week, signups FROM t WHERE r = '{{timeRange}}'",
  config: { xKey: "week", yKey: "signups", colors: ["#0284C7"] },
};

function dashboard(
  panels: Record<string, unknown>[] = [SIGNUPS],
  visibility: "private" | "org" | "public" = "org",
) {
  return {
    id: "growth",
    kind: "sql",
    title: "Growth",
    ownerEmail: "alice@example.com",
    orgId: "org-1",
    visibility,
    updatedAt: "2026-10-01T00:00:00.000Z",
    config: { name: "Growth", filters: [TIME_RANGE], panels },
  };
}

function result(rows: Record<string, unknown>[]) {
  return {
    rows,
    schema: Object.keys(rows[0] ?? {}).map((name) => ({
      name,
      type: "STRING",
    })),
  };
}

const CTX = {
  email: "alice@example.com",
  orgId: "org-1",
  timeoutMs: 10_000,
  maxChars: 49_000,
  now: Date.parse("2026-11-07T17:00:00.000Z"),
};

beforeEach(() => {
  process.env.DASHBOARD_REPORT_BASE_URL = "https://analytics.example.test";
  mocks.getDashboard.mockReset();
  mocks.getDashboard.mockResolvedValue(dashboard());
  mocks.loadBuiltin.mockReset();
  mocks.loadBuiltin.mockReturnValue(null);
  mocks.builtinVisibility.mockReset();
  mocks.builtinVisibility.mockReturnValue("org");
  mocks.resolvePanel.mockReset();
  mocks.resolvePanel.mockResolvedValue(
    result([
      { week: "2026-10-27", signups: 10 },
      { week: "2026-11-03", signups: 12 },
    ]),
  );
  mocks.listKeyDateSets.mockReset();
  mocks.listKeyDateSets.mockResolvedValue([]);
});

describe("captureDashboardPanel", () => {
  it("keeps a line panel's rows with the link it came from", async () => {
    const capture = await captureDashboardPanel(
      {
        dashboardId: "growth",
        panelId: "signups",
        filters: { timeRange: "90d" },
      },
      CTX,
    );

    expect(analyticsPanelCaptureSchema.parse(capture)).toEqual(capture);
    expect(capture).toMatchObject({
      dashboard: {
        id: "growth",
        title: "Growth",
        url: "https://analytics.example.test/dashboards/growth?f_timeRange=90d",
        visibility: "org",
      },
      panel: {
        id: "signups",
        title: "Signups",
        type: "line",
        url: "https://analytics.example.test/dashboards/growth?f_timeRange=90d&tile=signups",
      },
      filters: { timeRange: "90d" },
      filterSummary: "Range: Last 90 days",
      columns: ["week", "signups"],
      series: [{ label: "signups", color: "#0284C7" }],
      truncated: false,
      capturedAt: "2026-11-07T17:00:00.000Z",
    });
    expect(capture.rows.map((row) => row[1])).toEqual([10, 12]);
    expect(capture.panel.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    const [call] = mocks.resolvePanel.mock.calls;
    expect(call?.[0].query).toContain("r = '90d'");
  });

  it("runs the panel as the caller", async () => {
    await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(mocks.getDashboard).toHaveBeenCalledWith("growth", {
      email: "alice@example.com",
      orgId: "org-1",
    });
    const [call] = mocks.resolvePanel.mock.calls;
    expect(call?.[1]).toEqual({
      userEmail: "alice@example.com",
      orgId: "org-1",
    });
  });

  it("reads filters sent with or without the f_ prefix, and drops tab", async () => {
    const capture = await captureDashboardPanel(
      {
        dashboardId: "growth",
        panelId: "signups",
        filters: { f_timeRange: "90d", tab: "growth" },
      },
      CTX,
    );

    expect(capture.filters).toEqual({ timeRange: "90d" });
  });

  it("takes a built-in dashboard's audience from how it was installed", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    mocks.loadBuiltin.mockReturnValue(dashboard().config);
    mocks.builtinVisibility.mockReturnValue("private");

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(capture.dashboard.visibility).toBe("private");
  });

  it("refuses a dashboard the caller can't open", async () => {
    mocks.getDashboard.mockResolvedValue(null);

    await expect(
      captureDashboardPanel({ dashboardId: "growth", panelId: "signups" }, CTX),
    ).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });

  it("refuses a panel that is gone or has nothing to draw", async () => {
    await expect(
      captureDashboardPanel({ dashboardId: "growth", panelId: "gone" }, CTX),
    ).rejects.toMatchObject({ errorCode: "panel_not_found" });

    mocks.resolvePanel.mockResolvedValue(result([]));
    await expect(
      captureDashboardPanel({ dashboardId: "growth", panelId: "signups" }, CTX),
    ).rejects.toMatchObject({ errorCode: "panel_empty" });
  });

  it("refuses panel types a page can't draw yet", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([{ ...SIGNUPS, chartType: "heatmap" }]),
    );

    await expect(
      captureDashboardPanel({ dashboardId: "growth", panelId: "signups" }, CTX),
    ).rejects.toMatchObject({ errorCode: "panel_not_supported" });
  });

  it("keeps a metric as the value the dashboard shows", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          id: "total",
          title: "Total signups",
          source: "bigquery",
          chartType: "metric",
          width: 1,
          sql: "SELECT 1234 AS total",
          config: { yKey: "total" },
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(result([{ total: 1234 }]));

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "total" },
      CTX,
    );

    expect(capture.panel.type).toBe("metric");
    expect(capture.columns).toEqual(["total"]);
    expect(capture.rows).toEqual([[1234]]);
    expect(capture.display?.value).toBe("1,234");
  });

  it("keeps at most fifty table rows and says so", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          id: "accounts",
          title: "Accounts",
          source: "bigquery",
          chartType: "table",
          width: 2,
          sql: "SELECT name, seats FROM accounts",
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(
      result(
        Array.from({ length: 60 }, (_, index) => ({
          name: `Account ${index}`,
          seats: index,
        })),
      ),
    );

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "accounts" },
      CTX,
    );

    expect(capture.columns).toEqual(["name", "seats"]);
    expect(capture.rows).toHaveLength(50);
    expect(capture.truncated).toBe(true);
  });
});

describe("fitting a capture to the result limit", () => {
  function sizeOf(value: unknown) {
    return JSON.stringify(value, null, 2).length;
  }

  it("rounds long decimals and leaves whole numbers and money alone", () => {
    expect(roundCaptureNumber(0.00022222222222223066)).toBe(0.000222222);
    expect(roundCaptureNumber(0.9721851851851507)).toBe(0.972185);
    expect(roundCaptureNumber(1234567.891)).toBe(1234567.89);
    expect(roundCaptureNumber(1500)).toBe(1500);
    expect(roundCaptureNumber(-12.3456789)).toBe(-12.3457);
  });

  it("rounds the numbers a panel returns", async () => {
    mocks.resolvePanel.mockResolvedValue(
      result([{ week: "2026-11-03", signups: 0.12345678912 }]),
    );
    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    expect(capture.rows[0]?.[1]).toBe(0.123457);
  });

  it("keeps a long chart's latest points, and says so, when the copy would be cut off", async () => {
    mocks.resolvePanel.mockResolvedValue(
      result(
        Array.from({ length: 120 }, (_, index) => ({
          week: `2026-W${String(index).padStart(3, "0")}`,
          signups: index + 0.5,
        })),
      ),
    );
    const full = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    expect(full.truncated).toBe(false);

    const limit = Math.floor(sizeOf(full) / 2);
    const fitted = fitCaptureToChars(full, limit);
    expect(sizeOf(fitted)).toBeLessThanOrEqual(limit);
    expect(fitted.truncated).toBe(true);
    expect(fitted.rows.length).toBeLessThan(full.rows.length);
    expect(fitted.rows[fitted.rows.length - 1]).toEqual(
      full.rows[full.rows.length - 1],
    );
    expect(fitCaptureToChars(full, sizeOf(full))).toBe(full);
  });

  it("keeps the newest points of a chart whose query sorts newest first", async () => {
    const day = Date.parse("2026-11-01T00:00:00.000Z");
    mocks.resolvePanel.mockResolvedValue(
      result(
        Array.from({ length: 120 }, (_, index) => ({
          week: new Date(day - index * 86_400_000).toISOString().slice(0, 10),
          signups: index + 0.5,
        })),
      ),
    );
    const full = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    const fitted = fitCaptureToChars(full, Math.floor(sizeOf(full) / 2));
    expect(fitted.truncated).toBe(true);
    expect(fitted.rows[0]).toEqual(full.rows[0]);
    expect(fitted.rows[0]?.[0]).toBe("2026-11-01");
  });

  it("keeps a table's first rows", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          id: "accounts",
          title: "Accounts",
          source: "bigquery",
          sql: "select name, seats from accounts",
          chartType: "table",
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(
      result(
        Array.from({ length: 40 }, (_, index) => ({
          name: `Account ${index}`,
          seats: index,
        })),
      ),
    );
    const full = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "accounts" },
      CTX,
    );
    const fitted = fitCaptureToChars(full, Math.floor(sizeOf(full) / 2));
    expect(fitted.rows[0]).toEqual(full.rows[0]);
    expect(fitted.truncated).toBe(true);
  });

  it("refuses a panel whose single row is over the limit", async () => {
    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    expect(() => fitCaptureToChars(capture, 100)).toThrow(PanelCaptureError);
  });
});

describe("dashboardPanelStatus", () => {
  it("reports the sharing and each panel's fingerprint without running a query", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard([SIGNUPS], "private"));

    const status = await dashboardPanelStatus(
      { dashboardId: "growth", panelIds: ["signups", "gone"] },
      { email: "alice@example.com", orgId: "org-1" },
    );

    expect(status).toEqual({
      dashboard: { id: "growth", title: "Growth", visibility: "private" },
      panels: [
        {
          id: "signups",
          fingerprint: panelFingerprint(SIGNUPS as never),
          type: "line",
        },
        { id: "gone", fingerprint: null, type: null },
      ],
    });
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });

  it("changes a panel's fingerprint when its query changes, not its title", () => {
    const base = panelFingerprint(SIGNUPS as never);
    expect(panelFingerprint({ ...SIGNUPS, title: "Renamed" } as never)).toBe(
      base,
    );
    expect(panelFingerprint({ ...SIGNUPS, sql: "SELECT 2" } as never)).not.toBe(
      base,
    );
  });
});
