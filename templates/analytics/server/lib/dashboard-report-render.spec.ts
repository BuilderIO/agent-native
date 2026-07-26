import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlPanel } from "../../app/pages/adhoc/sql-dashboard/types";

const mocks = vi.hoisted(() => ({
  runWithRequestContext: vi.fn(
    (_ctx: unknown, fn: () => unknown | Promise<unknown>) => fn(),
  ),
  resolveAnalyticsPanelSource: vi.fn(),
  renderReportChartSvg: vi.fn(
    (_input: unknown) => "<svg xmlns='http://www.w3.org/2000/svg'/>",
  ),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
  resolveOgFontFiles: () => undefined,
}));
vi.mock("./dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolveAnalyticsPanelSource,
}));
vi.mock("./dashboard-panel-query", () => ({
  normalizeDashboardPanelQuery: (_source: string, query: unknown) => {
    if (!query || typeof query !== "string") {
      throw new Error("Missing or invalid query");
    }
    return query;
  },
}));
vi.mock("./report-chart-svg", () => ({
  renderReportChartSvg: mocks.renderReportChartSvg,
}));
vi.mock("@resvg/resvg-js", () => ({
  Resvg: class {
    constructor(
      readonly svg: string,
      readonly options: unknown,
    ) {}
    render() {
      return { asPng: () => new Uint8Array([137, 80, 78, 71]) };
    }
  },
}));

const { fetchReportPanelData, renderReportEmail } =
  await import("./dashboard-report-render");

function panel(overrides: Partial<SqlPanel> & { id: string }): SqlPanel {
  return {
    title: `Panel ${overrides.id}`,
    sql: "select 1",
    source: "first-party",
    chartType: "table",
    width: 1,
    ...overrides,
  };
}

function snapshotOf(panels: SqlPanel[]) {
  return {
    dashboardId: "dash_1",
    title: "Growth",
    filters: { f_timeRange: "30d" },
    dashboardUrl: "https://analytics.example.test/dashboards/dash_1",
    reportSettingsUrl:
      "https://analytics.example.test/dashboards/dash_1?reportSettings=1",
    generatedAt: "2026-07-26T00:00:00.000Z",
    panelIds: panels.filter((p) => p.chartType !== "section").map((p) => p.id),
    panels,
  };
}

const owner = { ownerEmail: "owner@example.test", orgId: "org_1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runWithRequestContext.mockImplementation(
    (_ctx: unknown, fn: () => unknown | Promise<unknown>) => fn(),
  );
  mocks.renderReportChartSvg.mockReturnValue(
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
  );
});

describe("fetchReportPanelData", () => {
  it("keeps a failed query distinguishable from an empty result set", async () => {
    mocks.resolveAnalyticsPanelSource.mockImplementation(
      async (request: { query: string }) => {
        if (request.query.includes("boom")) {
          throw new Error('relation "events" does not exist');
        }
        return { rows: [], schema: [] };
      },
    );

    const data = await fetchReportPanelData({
      ...owner,
      snapshot: snapshotOf([
        panel({ id: "broken", sql: "select boom" }),
        panel({ id: "empty", sql: "select nothing" }),
      ]),
    });

    expect(data.get("broken")).toEqual({
      status: "query-failed",
      message: 'relation "events" does not exist',
    });
    expect(data.get("empty")).toEqual({ status: "rows", rows: [], schema: [] });
  });

  it("maps a missing-credential response to its own status", async () => {
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      error: "missing_api_key",
      key: "BIGQUERY_PROJECT_ID",
      label: "BigQuery",
      message: "Connect your BigQuery account to see this data",
      settingsPath: "/data-sources",
    });

    const data = await fetchReportPanelData({
      ...owner,
      snapshot: snapshotOf([panel({ id: "bq", source: "bigquery" })]),
    });

    expect(data.get("bq")).toEqual({
      status: "missing-credential",
      message: "Connect your BigQuery account to see this data",
    });
  });

  it("runs every panel under the subscription owner's request context", async () => {
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [],
      schema: [],
    });

    await fetchReportPanelData({
      ...owner,
      snapshot: snapshotOf([panel({ id: "a" }), panel({ id: "b" })]),
    });

    expect(mocks.runWithRequestContext).toHaveBeenCalledTimes(1);
    expect(mocks.runWithRequestContext.mock.calls[0][0]).toEqual({
      userEmail: "owner@example.test",
      orgId: "org_1",
    });
    expect(mocks.resolveAnalyticsPanelSource.mock.calls[0][1]).toEqual({
      userEmail: "owner@example.test",
      orgId: "org_1",
    });
  });

  it("does not query unscoped when there is no owner", async () => {
    const data = await fetchReportPanelData({
      ownerEmail: "  ",
      snapshot: snapshotOf([panel({ id: "a" })]),
    });

    expect(data.get("a")?.status).toBe("missing-credential");
    expect(mocks.resolveAnalyticsPanelSource).not.toHaveBeenCalled();
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
  });

  it("marks extension panels not-emailable and skips section panels", async () => {
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [],
      schema: [],
    });

    const data = await fetchReportPanelData({
      ...owner,
      snapshot: snapshotOf([
        panel({ id: "head", chartType: "section" }),
        panel({ id: "ext", chartType: "extension" }),
      ]),
    });

    expect(data.has("head")).toBe(false);
    expect(data.get("ext")?.status).toBe("not-emailable");
    expect(mocks.resolveAnalyticsPanelSource).not.toHaveBeenCalled();
  });

  it("lets healthy panels resolve while another panel hangs past its timeout", async () => {
    mocks.resolveAnalyticsPanelSource.mockImplementation(
      async (request: { query: string }) => {
        if (request.query.includes("slow")) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          return { rows: [{ n: 1 }], schema: [] };
        }
        return { rows: [{ n: 2 }], schema: [] };
      },
    );

    const data = await fetchReportPanelData({
      ...owner,
      perPanelTimeoutMs: 20,
      snapshot: snapshotOf([
        panel({ id: "slow", sql: "select slow" }),
        panel({ id: "fast", sql: "select fast" }),
      ]),
    });

    expect(data.get("slow")).toEqual({
      status: "query-failed",
      message: "Panel query timed out after 0s",
    });
    expect(data.get("fast")).toEqual({
      status: "rows",
      rows: [{ n: 2 }],
      schema: [],
    });
  });

  it("fails the panel loudly when a source returns no row set", async () => {
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({ schema: [] });

    const data = await fetchReportPanelData({
      ...owner,
      snapshot: snapshotOf([panel({ id: "a" })]),
    });

    expect(data.get("a")).toEqual({
      status: "query-failed",
      message: "Panel source returned no row set",
    });
  });

  it("redacts credential-looking text from query errors", async () => {
    mocks.resolveAnalyticsPanelSource.mockRejectedValue(
      new Error("auth failed: api_key=sk-not-a-real-key"),
    );

    const data = await fetchReportPanelData({
      ...owner,
      snapshot: snapshotOf([panel({ id: "a" })]),
    });

    const result = data.get("a");
    expect(result?.status).toBe("query-failed");
    expect(result && "message" in result ? result.message : "").not.toContain(
      "sk-not-a-real-key",
    );
  });
});

describe("renderReportEmail", () => {
  it("reports no degraded panels for a fully successful report", async () => {
    const panels = [
      panel({ id: "t1" }),
      panel({ id: "m1", chartType: "metric", config: { yKey: "total" } }),
    ];
    const rendered = await renderReportEmail({
      snapshot: snapshotOf(panels),
      panelData: new Map([
        ["t1", { status: "rows" as const, rows: [{ a: 1 }], schema: [] }],
        [
          "m1",
          { status: "rows" as const, rows: [{ total: 4200 }], schema: [] },
        ],
      ]),
    });

    expect(rendered.degradedPanelIds).toEqual([]);
    expect(rendered.html).toContain("4,200");
    expect(rendered.html).not.toContain("incomplete");
  });

  it("treats a genuinely empty result as complete, not degraded", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([panel({ id: "t1" })]),
      panelData: new Map([
        ["t1", { status: "rows" as const, rows: [], schema: [] }],
      ]),
    });

    expect(rendered.degradedPanelIds).toEqual([]);
    expect(rendered.html).toContain("No rows returned.");
  });

  it("marks failed and missing-credential panels degraded and names the reason", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({ id: "ok" }),
        panel({ id: "bad" }),
        panel({ id: "nokey" }),
        panel({ id: "never" }),
      ]),
      panelData: new Map([
        ["ok", { status: "rows" as const, rows: [{ a: 1 }], schema: [] }],
        [
          "bad",
          {
            status: "query-failed" as const,
            message: "syntax error at line 3",
          },
        ],
        [
          "nokey",
          {
            status: "missing-credential" as const,
            message: "Connect your BigQuery account to see this data",
          },
        ],
      ]),
    });

    expect(rendered.degradedPanelIds).toEqual(["bad", "nokey", "never"]);
    expect(rendered.html).toContain("syntax error at line 3");
    expect(rendered.html).toContain("Connect your BigQuery account");
    expect(rendered.html).toContain("could not be rendered from real data");
    expect(rendered.text).toContain("INCOMPLETE REPORT");
  });

  it("escapes hostile panel titles and cell values", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "x",
          title: "<script>alert('t')</script>",
          config: { columns: [{ key: "name" }] },
        }),
      ]),
      panelData: new Map([
        [
          "x",
          {
            status: "rows" as const,
            rows: [{ name: "<img src=x onerror=alert(1)>" }],
            schema: [],
          },
        ],
      ]),
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("only emits http(s) hrefs for link columns", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "links",
          config: {
            columns: [
              { key: "safe", format: "link" },
              { key: "unsafe", format: "link" },
            ],
          },
        }),
      ]),
      panelData: new Map([
        [
          "links",
          {
            status: "rows" as const,
            rows: [
              {
                safe: "https://example.test/a",
                unsafe: "javascript:alert(1)",
              },
            ],
            schema: [],
          },
        ],
      ]),
    });

    expect(rendered.html).toContain('href="https://example.test/a"');
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).toContain(
      '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">javascript:alert(1)</td>',
    );
  });

  it("attaches exactly one inline PNG per chart panel and references it by cid", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "chart 1",
          chartType: "bar",
          config: { xKey: "day", yKeys: ["signups"] },
        }),
      ]),
      panelData: new Map([
        [
          "chart 1",
          {
            status: "rows" as const,
            rows: [
              { day: "2026-07-01", signups: 3 },
              { day: "2026-07-02", signups: 5 },
            ],
            schema: [],
          },
        ],
      ]),
    });

    expect(rendered.attachments).toHaveLength(1);
    const [attachment] = rendered.attachments;
    expect(attachment.disposition).toBe("inline");
    expect(attachment.contentType).toBe("image/png");
    expect(attachment.content.byteLength).toBeGreaterThan(0);
    expect(rendered.html).toContain(`cid:${attachment.contentId}`);
    expect(rendered.degradedPanelIds).toEqual([]);

    const chartInput = mocks.renderReportChartSvg.mock.calls[0][0] as {
      labels: string[];
      series: Array<{ label: string; data: Array<number | null> }>;
      type: string;
    };
    expect(chartInput.type).toBe("bar");
    expect(chartInput.labels).toEqual(["2026-07-01", "2026-07-02"]);
    expect(chartInput.series).toEqual([
      { label: "signups", data: [3, 5], color: expect.any(String) },
    ]);
  });

  it("does not invent zero bars for days a pivoted bar chart never returned", async () => {
    await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "bars",
          chartType: "bar",
          config: { pivot: { xKey: "day", seriesKey: "team", valueKey: "n" } },
        }),
      ]),
      panelData: new Map([
        [
          "bars",
          {
            status: "rows" as const,
            rows: [
              { day: "2026-07-01", team: "alpha", n: 5 },
              { day: "2026-07-03", team: "alpha", n: 7 },
            ],
            schema: [],
          },
        ],
      ]),
    });

    const chartInput = mocks.renderReportChartSvg.mock.calls[0][0] as {
      labels: string[];
      series: Array<{ data: Array<number | null> }>;
    };
    expect(chartInput.labels).toEqual(["2026-07-01", "2026-07-03"]);
    expect(chartInput.series[0].data).toEqual([5, 7]);
  });

  it("pivots table panels the way the dashboard does", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "pivoted",
          chartType: "table",
          config: { pivot: { xKey: "day", seriesKey: "team", valueKey: "n" } },
        }),
      ]),
      panelData: new Map([
        [
          "pivoted",
          {
            status: "rows" as const,
            rows: [
              { day: "2026-07-01", team: "alpha", n: 5 },
              { day: "2026-07-01", team: "beta", n: 3 },
            ],
            schema: [],
          },
        ],
      ]),
    });

    expect(rendered.text).toContain("day | alpha | beta");
    expect(rendered.text).toContain("2026-07-01 | 5 | 3");
    expect(rendered.text).not.toContain("| team |");
  });

  it("charts legacy stacked-* panels instead of dropping them to a table", async () => {
    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "legacy",
          chartType: "stacked-area" as SqlPanel["chartType"],
          config: { xKey: "day", yKeys: ["n"] },
        }),
      ]),
      panelData: new Map([
        [
          "legacy",
          {
            status: "rows" as const,
            rows: [
              { day: "2026-07-01", n: 1 },
              { day: "2026-07-02", n: 2 },
            ],
            schema: [],
          },
        ],
      ]),
    });

    expect(rendered.attachments).toHaveLength(1);
    expect(
      (mocks.renderReportChartSvg.mock.calls[0][0] as { type: string }).type,
    ).toBe("area");
  });

  it("ignores config.color, which the dashboard never uses as a chart color", async () => {
    await renderReportEmail({
      snapshot: snapshotOf([
        panel({
          id: "colored",
          chartType: "bar",
          config: { xKey: "day", yKeys: ["n"], color: "region" },
        }),
      ]),
      panelData: new Map([
        [
          "colored",
          {
            status: "rows" as const,
            rows: [{ day: "2026-07-01", n: 1 }],
            schema: [],
          },
        ],
      ]),
    });

    const chartInput = mocks.renderReportChartSvg.mock.calls[0][0] as {
      series: Array<{ color: string }>;
    };
    expect(chartInput.series[0].color).toBe("#2563eb");
  });

  it("degrades a chart panel when rasterization is unavailable", async () => {
    mocks.renderReportChartSvg.mockImplementation(() => {
      throw new Error("Failed to load native binding");
    });

    const rendered = await renderReportEmail({
      snapshot: snapshotOf([
        panel({ id: "chart", chartType: "line", config: { xKey: "day" } }),
      ]),
      panelData: new Map([
        [
          "chart",
          {
            status: "rows" as const,
            rows: [{ day: "2026-07-01", signups: 3 }],
            schema: [],
          },
        ],
      ]),
    });

    expect(rendered.attachments).toEqual([]);
    expect(rendered.degradedPanelIds).toEqual(["chart"]);
    expect(rendered.html).toContain("Failed to load native binding");
  });
});
