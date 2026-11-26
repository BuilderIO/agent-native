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
        source: "bigquery",
        url: "https://analytics.example.test/dashboards/growth?f_timeRange=90d&tile=signups",
      },
      filters: { timeRange: "90d" },
      filterSummary: "Range: Last 90 days",
      chart: { xKey: "week", yKey: "signups", colors: ["#0284C7"] },
      columns: ["week", "signups"],
      truncated: false,
      capturedAt: "2026-11-07T17:00:00.000Z",
    });
    expect(capture.rows.map((row) => row[1])).toEqual([10, 12]);
    expect(capture.panel.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    // Only a pivot fills its days across the dashboard's range.
    expect(capture).not.toHaveProperty("timeRange");
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

  it("keeps a pivoted panel's rows as its query returns them, with the pivot that draws them", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          ...SIGNUPS,
          chartType: "bar",
          config: {
            pivot: { xKey: "week", seriesKey: "plan", valueKey: "signups" },
            stacked: true,
          },
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(
      result([
        { week: "2026-10-27", plan: "Free", signups: 7 },
        { week: "2026-10-27", plan: "Pro", signups: 3 },
        { week: "2026-11-03", plan: "Free", signups: 9 },
      ]),
    );

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(capture.columns).toEqual(["week", "plan", "signups"]);
    expect(capture.rows).toEqual([
      ["2026-10-27", "Free", 7],
      ["2026-10-27", "Pro", 3],
      ["2026-11-03", "Free", 9],
    ]);
    expect(capture.chart).toEqual({
      pivot: { xKey: "week", seriesKey: "plan", valueKey: "signups" },
      stacked: true,
    });
  });

  it("keeps only the chart settings that change the drawing", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          ...SIGNUPS,
          config: {
            xKey: "week",
            yKey: "signups",
            yFormatter: "percent",
            seriesLabels: { signups: "New signups" },
            // Not a color the contract allows, so the page draws its own.
            colors: ["url(#shadow)"],
            description: "d".repeat(2500),
            drilldown: { sql: "SELECT * FROM t WHERE week = '{{drillX}}'" },
            breakdowns: [{ key: "plan", label: "Plan" }],
          },
        },
      ]),
    );

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(capture.chart).toEqual({
      xKey: "week",
      yKey: "signups",
      yFormatter: "percent",
      seriesLabels: { signups: "New signups" },
      description: "d".repeat(2000),
    });
  });

  it("marks the panel's events and the dashboard's key dates that land on its chart", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          ...SIGNUPS,
          config: {
            ...SIGNUPS.config,
            events: [{ date: "2026-10-28", label: "Pricing page" }],
          },
        },
      ]),
    );
    mocks.listKeyDateSets.mockResolvedValue([
      {
        id: "launches",
        dates: [
          { date: "2026-11-03", label: "Launch week", time: "09:00" },
          { date: "2025-01-01", label: "Long before the chart" },
        ],
      },
    ]);

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(capture.chart.events).toEqual([
      { date: "2026-10-28", label: "Pricing page" },
      { date: "2026-11-03", time: "09:00", label: "Launch week" },
    ]);
  });

  it("keeps only the columns its chart draws", async () => {
    mocks.resolvePanel.mockResolvedValue(
      result([
        { week: "2026-10-27", signups: 10, email: "ada@example.com" },
        { week: "2026-11-03", signups: 12, email: "grace@example.com" },
      ]),
    );
    const named = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    expect(named.columns).toEqual(["week", "signups"]);
    expect(JSON.stringify(named)).not.toContain("example.com");
    expect(named.truncated).toBe(false);

    // Keys the chart finds for itself count the same way.
    mocks.getDashboard.mockResolvedValue(
      dashboard([{ ...SIGNUPS, config: {} }]),
    );
    const found = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    expect(found.columns).toEqual(["week", "signups"]);
  });

  it("keeps a table's shown columns, not its hidden ones", async () => {
    const hidden = Array.from({ length: 24 }, (_, index) => ({
      key: `h${index}`,
      hidden: true,
    }));
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          id: "accounts",
          title: "Accounts",
          source: "bigquery",
          chartType: "table",
          width: 2,
          sql: "SELECT * FROM accounts",
          config: { columns: [{ key: "name", label: "Account" }, ...hidden] },
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(
      result([
        {
          name: "Globex",
          ...Object.fromEntries(hidden.map((column) => [column.key, 1])),
        },
      ]),
    );

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "accounts" },
      CTX,
    );

    expect(capture.columns).toEqual(["name"]);
    expect(capture.chart.columns).toEqual([{ key: "name", label: "Account" }]);
    expect(capture.truncated).toBe(false);
  });

  it("keeps the first columns a chart draws when it draws too many", async () => {
    const wide = Object.fromEntries([
      ["day", "2026-11-03"],
      ...Array.from({ length: 30 }, (_, index) => [`c${index}`, index]),
    ]);
    mocks.getDashboard.mockResolvedValue(
      dashboard([{ ...SIGNUPS, chartType: "bar", config: { xKey: "day" } }]),
    );
    mocks.resolvePanel.mockResolvedValue(result([wide]));

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(capture.columns).toHaveLength(24);
    expect(capture.columns[0]).toBe("day");
    expect(capture.truncated).toBe(true);
  });

  it("keeps whole dates of a pivoted chart when it keeps fewer rows", async () => {
    const plans = ["Free", "Pro", "Team"];
    const start = Date.parse("2025-01-01T00:00:00.000Z");
    // 334 dates of three rows each: 1,002 rows, two more than a page keeps.
    const rows = Array.from({ length: 334 }, (_, day) =>
      plans.map((plan) => ({
        day: new Date(start + day * 86_400_000).toISOString().slice(0, 10),
        plan,
        signups: day + 1,
      })),
    ).flat();
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          ...SIGNUPS,
          chartType: "bar",
          config: {
            pivot: { xKey: "day", seriesKey: "plan", valueKey: "signups" },
          },
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(result(rows));
    const rowsPerDay = (kept: unknown[][]) => {
      const perDay = new Map<unknown, number>();
      for (const row of kept) perDay.set(row[0], (perDay.get(row[0]) ?? 0) + 1);
      return new Set(perDay.values());
    };

    // With room to spare, the row limit cuts the oldest date whole.
    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      { ...CTX, maxChars: 200_000 },
    );
    expect(capture.truncated).toBe(true);
    expect(capture.rows).toHaveLength(999);
    expect(capture.rows[0]).toEqual(["2025-01-02", "Free", 2]);
    expect(rowsPerDay(capture.rows)).toEqual(new Set([3]));

    // An answer cut to fit its size keeps whole dates as well.
    const fitted = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );
    expect(fitted.rows.length).toBeLessThan(999);
    expect(fitted.rows[fitted.rows.length - 1]).toEqual([
      "2025-11-30",
      "Team",
      334,
    ]);
    expect(rowsPerDay(fitted.rows)).toEqual(new Set([3]));
  });

  it("keeps the newest whole times of a pivot whose rows come one series after another", async () => {
    const start = Date.parse("2026-11-07T10:00:00.000Z");
    // Prometheus returns each series' points in turn: 3 series of 400 points.
    const rows = ["Total", "Used", "Free"].flatMap((series) =>
      Array.from({ length: 400 }, (_, index) => ({
        timestamp: new Date(start + index * 15_000).toISOString(),
        series,
        value: index,
      })),
    );
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          ...SIGNUPS,
          source: "prometheus",
          chartType: "area",
          config: {
            xKey: "timestamp",
            yKey: "value",
            pivot: {
              xKey: "timestamp",
              seriesKey: "series",
              valueKey: "value",
            },
          },
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(result(rows));

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      { ...CTX, maxChars: 200_000 },
    );

    expect(capture.truncated).toBe(true);
    expect(capture.rows).toHaveLength(999);
    const times = new Set(capture.rows.map((row) => row[0]));
    expect(times.size).toBe(333);
    expect(times.has(new Date(start + 399 * 15_000).toISOString())).toBe(true);
    expect(times.has(new Date(start + 66 * 15_000).toISOString())).toBe(false);
  });

  it("keeps a pivoted line's time range, ending on the day it was kept", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          ...SIGNUPS,
          config: {
            pivot: { xKey: "week", seriesKey: "plan", valueKey: "signups" },
          },
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(
      result([
        { week: "2026-11-02", plan: "Free", signups: 7 },
        { week: "2026-11-03", plan: "Free", signups: 9 },
      ]),
    );
    // Before the panel's first row, but inside the dashboard's 30 days.
    mocks.listKeyDateSets.mockResolvedValue([
      { id: "launches", dates: [{ date: "2026-10-20", label: "Beta" }] },
    ]);

    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups" },
      CTX,
    );

    expect(capture.timeRange).toBe(30);
    expect(capture.chart.events).toEqual([
      { date: "2026-10-20", label: "Beta" },
    ]);
  });

  it("refuses a metric that adds up more rows than a page keeps", async () => {
    mocks.getDashboard.mockResolvedValue(
      dashboard([
        {
          id: "total",
          title: "Total signups",
          source: "bigquery",
          chartType: "metric",
          width: 1,
          sql: "SELECT signups FROM t",
        },
      ]),
    );
    mocks.resolvePanel.mockResolvedValue(
      result(Array.from({ length: 1001 }, () => ({ signups: 1 }))),
    );

    await expect(
      captureDashboardPanel({ dashboardId: "growth", panelId: "total" }, CTX),
    ).rejects.toMatchObject({ errorCode: "panel_not_supported" });
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
    const capture = await captureDashboardPanel(
      { dashboardId: "growth", panelId: "signups", filters: {} },
      CTX,
    );
    mocks.resolvePanel.mockClear();

    const status = await dashboardPanelStatus(
      { dashboardId: "growth", panelIds: ["signups", "gone"] },
      { email: "alice@example.com", orgId: "org-1" },
    );

    expect(status).toEqual({
      dashboard: { id: "growth", title: "Growth", visibility: "private" },
      panels: [
        {
          id: "signups",
          fingerprint: capture.panel.fingerprint,
          type: "line",
        },
        { id: "gone", fingerprint: null, type: null },
      ],
    });
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });

  it("changes a panel's fingerprint when its query changes, not its title", () => {
    const config = dashboard().config;
    const base = panelFingerprint(SIGNUPS as never, config);
    expect(
      panelFingerprint({ ...SIGNUPS, title: "Renamed" } as never, config),
    ).toBe(base);
    expect(
      panelFingerprint({ ...SIGNUPS, sql: "SELECT 2" } as never, config),
    ).not.toBe(base);
  });

  it("changes a panel's fingerprint when a filter default or variable it's built from changes, not a label", () => {
    const config = dashboard().config;
    const base = panelFingerprint(SIGNUPS as never, config);
    const withFilter = (filter: Record<string, unknown>) =>
      panelFingerprint(SIGNUPS as never, { ...config, filters: [filter] });

    expect(withFilter({ ...TIME_RANGE, label: "Period" })).toBe(base);
    expect(withFilter({ ...TIME_RANGE, default: "90d" })).not.toBe(base);
    expect(
      panelFingerprint(SIGNUPS as never, {
        ...config,
        variables: { region: "eu" },
      }),
    ).not.toBe(base);
  });
});
