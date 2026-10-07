import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFilterVars } from "../app/pages/adhoc/sql-dashboard/filter-vars";
import { interpolateDashboardPanelSql } from "../app/pages/adhoc/sql-dashboard/interpolate";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  resolvePanel: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "alice@example.com",
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: () => ({
    userEmail: "alice@example.com",
    orgId: "org-1",
  }),
}));
vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));

const { default: inspectDashboardPanel } =
  await import("./inspect-dashboard-panel");

const TIME_RANGE = {
  id: "timeRange",
  type: "select",
  label: "Range",
  default: "30d",
  options: ["7d", "30d"].map((value) => ({ value, label: value })),
};

const ROWS = [
  { week: "2026-09-01", signups: 10, note: "x".repeat(300) },
  { week: "2026-09-08", signups: 12, note: "y" },
];

function lineDashboard(panelOverrides: Record<string, unknown> = {}) {
  return {
    kind: "sql",
    updatedAt: "2026-10-01T00:00:00.000Z",
    config: {
      name: "Growth",
      filters: [TIME_RANGE],
      panels: [
        {
          id: "signups",
          title: "Signups",
          source: "bigquery",
          chartType: "line",
          width: 2,
          sql: "SELECT week, signups FROM t WHERE r = '{{timeRange}}'",
          ...panelOverrides,
        },
        { id: "intro", title: "Intro", chartType: "section", width: 6 },
      ],
    },
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

function run(args: Record<string, unknown>) {
  return inspectDashboardPanel.run(
    inspectDashboardPanel.schema.parse({
      dashboardId: "growth",
      panelId: "signups",
      ...args,
    }),
  ) as Promise<any>;
}

beforeEach(() => {
  mocks.getDashboard.mockReset();
  mocks.getDashboard.mockResolvedValue(lineDashboard());
  mocks.resolvePanel.mockReset();
  mocks.resolvePanel.mockResolvedValue(result(ROWS));
});

describe("inspect-dashboard-panel", () => {
  it("is a read-only agent tool, unlike the UI-only panel query action", () => {
    expect(inspectDashboardPanel.readOnly).toBe(true);
    expect(inspectDashboardPanel.agentTool).not.toBe(false);
  });

  it("reports what the page shows for the saved panel under default filters", async () => {
    const inspected = await run({});

    expect(inspected).toMatchObject({
      dashboardId: "growth",
      dashboardUpdatedAt: "2026-10-01T00:00:00.000Z",
      panelId: "signups",
      status: "ok",
      rowCount: 2,
      renderedRowCount: 2,
      columns: ["week", "signups", "note"],
      missingKeys: [],
      filterState: "defaults",
      resolvedFilters: { timeRange: "30d" },
    });
    expect(inspected.summary).toContain("renders 2 row(s)");
    const sql = "SELECT week, signups FROM t WHERE r = '{{timeRange}}'";
    expect(mocks.resolvePanel.mock.calls[0][0].query).toBe(
      interpolateDashboardPanelSql(
        sql,
        resolveFilterVars([TIME_RANGE] as never, () => ""),
        { source: "bigquery", config: undefined },
      ),
    );
  });

  it("applies filter overrides to the SQL and echoes them", async () => {
    const inspected = await run({ filters: { timeRange: "7d" } });

    expect(mocks.resolvePanel.mock.calls[0][0].query).toContain("r = '7d'");
    expect(inspected).toMatchObject({
      filterState: "overridden",
      resolvedFilters: { timeRange: "7d" },
    });
    expect(inspected.resolvedSql).toContain("r = '7d'");
  });

  it("caps sample rows and truncates long cells", async () => {
    mocks.resolvePanel.mockResolvedValue(
      result(
        Array.from({ length: 50 }, (_, i) => ({
          week: `w${i}`,
          signups: i,
          note: "z".repeat(500),
        })),
      ),
    );

    const inspected = await run({ sampleRows: 20 });

    expect(inspected.sample).toHaveLength(20);
    expect(inspected.sample[0].note.length).toBeLessThan(100);
    expect(inspected.rowCount).toBe(50);
    expect(() =>
      inspectDashboardPanel.schema.parse({
        dashboardId: "growth",
        panelId: "signups",
        sampleRows: 21,
      }),
    ).toThrow();
    expect((await run({})).sample).toHaveLength(5);
  });

  it("caps the resolved SQL it returns", async () => {
    mocks.getDashboard.mockResolvedValue(
      lineDashboard({
        sql: `SELECT week, signups FROM t WHERE r = '{{timeRange}}' /* ${"c".repeat(5000)} */`,
      }),
    );

    const inspected = await run({});

    expect(inspected.resolvedSql.length).toBe(2000);
  });

  it("reports a stale pivot as the viewer would see it", async () => {
    mocks.getDashboard.mockResolvedValue(
      lineDashboard({
        config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } },
      }),
    );

    const inspected = await run({});

    expect(inspected).toMatchObject({
      status: "missing-columns",
      rowCount: 2,
      renderedRowCount: 0,
      missingKeys: ["app", "n"],
    });
    expect(inspected.hint).toContain("Remove config.pivot");
  });

  it("returns a failed query as query-error, not an empty result", async () => {
    mocks.resolvePanel.mockResolvedValue({
      error: "bad_query",
      message: "Unrecognized name: nope",
    });

    const inspected = await run({});

    expect(inspected).toMatchObject({
      status: "query-error",
      error: "Unrecognized name: nope",
    });
  });

  it("bypasses the result cache only when asked", async () => {
    await run({});
    await run({ forceRefresh: true });

    expect(mocks.resolvePanel.mock.calls[0][0].forceRefresh).toBeUndefined();
    expect(mocks.resolvePanel.mock.calls[1][0].forceRefresh).toBe(true);
  });

  it("reads the dashboard through the caller's scope and leaks nothing for another user's dashboard", async () => {
    mocks.getDashboard.mockResolvedValue(null);

    await expect(run({})).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
    expect(mocks.getDashboard).toHaveBeenCalledWith("growth", {
      email: "alice@example.com",
      orgId: "org-1",
    });
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });

  it("lists the valid panel ids for an unknown panel", async () => {
    await expect(run({ panelId: "nope" })).rejects.toMatchObject({
      errorCode: "panel_not_found",
      message: expect.stringContaining("Panel ids: signups, intro"),
    });
  });

  it("refuses section panels and non-SQL dashboards", async () => {
    await expect(run({ panelId: "intro" })).rejects.toMatchObject({
      errorCode: "panel_not_queryable",
    });

    mocks.getDashboard.mockResolvedValue({
      ...lineDashboard(),
      kind: "explorer",
    });
    await expect(run({})).rejects.toMatchObject({
      errorCode: "dashboard_not_sql",
    });
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });
});
