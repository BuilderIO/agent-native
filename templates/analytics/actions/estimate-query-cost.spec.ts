import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "caller@example.test" as string | null),
  getCredentialContext: vi.fn(
    () => null as { credentialScope?: string } | null,
  ),
  getDashboard: vi.fn(),
  loadDashboardSeed: vi.fn(() => null as unknown),
  pageDashboardConfig: vi.fn((config: unknown) => config),
  resolvePanels: vi.fn(),
  countReports: vi.fn(async () => 0),
  estimateBigQuerySql: vi.fn(),
  estimateFirstPartySql: vi.fn(),
  estimateResolvedPanel: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(definition: T) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
}));

vi.mock("../server/lib/dashboard-seeds", () => ({
  loadDashboardSeed: mocks.loadDashboardSeed,
}));

vi.mock("../server/lib/dashboard-panel-verification", () => ({
  pageDashboardConfig: mocks.pageDashboardConfig,
  resolveDashboardPanelQueries: mocks.resolvePanels,
}));

vi.mock("../server/lib/dashboard-report-subscriptions", () => ({
  countEnabledDashboardReportSubscriptions: mocks.countReports,
}));

// Keep the real cost math without loading BigQuery or first-party analytics.
vi.mock("../server/lib/bigquery", () => ({
  dryRunQuerySchema: vi.fn(),
  BigQueryDryRunPreparationError: class extends Error {},
}));

vi.mock("../server/lib/first-party-analytics", () => ({
  renderFirstPartyAnalyticsBigQueryEstimateSql: vi.fn(),
}));

vi.mock("../server/lib/query-cost-estimate", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/query-cost-estimate")
  >()),
  estimateBigQuerySql: mocks.estimateBigQuerySql,
  estimateFirstPartySql: mocks.estimateFirstPartySql,
  estimateResolvedPanel: mocks.estimateResolvedPanel,
}));

import { costFromBytes } from "../server/lib/query-cost-estimate";
import action from "./estimate-query-cost";

const GIB = 1024 ** 3;
const signal = new AbortController().signal;
const context = { signal } as ActionRunContext;

function run(input: Record<string, unknown>) {
  return action.run(action.schema.parse(input), context) as Promise<
    Record<string, any>
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.getRequestUserEmail.mockReturnValue("caller@example.test");
  mocks.getCredentialContext.mockReturnValue(null);
  mocks.loadDashboardSeed.mockReturnValue(null);
  mocks.countReports.mockResolvedValue(0);
  mocks.estimateResolvedPanel.mockImplementation(
    async (panel, _scope, runsPerMonth) => ({
      panelId: panel.panelId,
      title: panel.title,
      source: panel.source,
      ...costFromBytes(panel.panelId === "big" ? 190 * GIB : GIB, runsPerMonth),
    }),
  );
});

describe("estimate-query-cost action", () => {
  it("is a read-only tool external agents can call", () => {
    expect(action).toMatchObject({
      readOnly: true,
      mcpTool: true,
      publicAgent: { expose: true, readOnly: true, requiresAuth: true },
    });
  });

  it("needs exactly one of sql or dashboardId", async () => {
    await expect(run({})).rejects.toMatchObject({
      errorCode: "invalid_target",
    });
    await expect(
      run({ sql: "SELECT 1", dashboardId: "d1" }),
    ).rejects.toMatchObject({ errorCode: "invalid_target" });
    await expect(run({ sql: "SELECT 1", panelId: "p1" })).rejects.toMatchObject(
      { errorCode: "invalid_target" },
    );
  });

  it("requires a signed-in caller", async () => {
    mocks.getRequestUserEmail.mockReturnValueOnce(null);
    await expect(run({ sql: "SELECT 1" })).rejects.toMatchObject({
      errorCode: "unauthenticated",
      statusCode: 401,
    });
    expect(mocks.estimateBigQuerySql).not.toHaveBeenCalled();
  });

  it("estimates raw BigQuery SQL with the caller's runs per month", async () => {
    mocks.estimateBigQuerySql.mockResolvedValueOnce(
      costFromBytes(190 * GIB, 8640),
    );

    const result = await run({ sql: "SELECT 1", runsPerMonth: 8640 });

    expect(mocks.estimateBigQuerySql).toHaveBeenCalledWith(
      "SELECT 1",
      8640,
      signal,
    );
    expect(result).toMatchObject({
      target: "sql",
      source: "bigquery",
      status: "estimated",
      overPerRunThreshold: true,
      overPerMonthThreshold: true,
      pricing: { model: "on-demand", usdPerTiB: 6.25 },
    });
    expect(result.summary).toContain("190.0 GiB");
    expect(result.summary).toContain("over the $1.00/run threshold");
  });

  it("routes first-party SQL through the caller's analytics scope", async () => {
    mocks.getCredentialContext.mockReturnValueOnce({ credentialScope: "org" });
    mocks.estimateFirstPartySql.mockResolvedValueOnce(costFromBytes(GIB, null));

    await run({ sql: "SELECT 1 FROM analytics_events", source: "first-party" });

    expect(mocks.estimateFirstPartySql).toHaveBeenCalledWith(
      "SELECT 1 FROM analytics_events",
      {
        userEmail: "caller@example.test",
        orgId: "org-1",
        credentialScope: "org",
      },
      null,
      signal,
    );
  });

  it("refuses unsafe or missing dashboards", async () => {
    await expect(run({ dashboardId: "../etc" })).rejects.toMatchObject({
      errorCode: "invalid_dashboard_id",
    });
    mocks.getDashboard.mockResolvedValueOnce(null);
    await expect(run({ dashboardId: "missing" })).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
  });

  it("estimates every panel and prices daily email reports per month", async () => {
    mocks.getDashboard.mockResolvedValueOnce({ kind: "sql", config: {} });
    mocks.countReports.mockResolvedValueOnce(2);
    mocks.resolvePanels.mockReturnValueOnce([
      {
        panelId: "small",
        title: "Small",
        source: "bigquery",
        query: "SELECT 1",
      },
      { panelId: "big", title: "Big", source: "bigquery", query: "SELECT 2" },
    ]);

    const result = await run({ dashboardId: "d1" });

    expect(mocks.getDashboard).toHaveBeenCalledWith("d1", {
      email: "caller@example.test",
      orgId: "org-1",
    });
    expect(result.runsPerMonth).toBe(60);
    expect(result.runsPerMonthBasis).toBe("2 enabled daily email reports");
    expect(result.panels).toHaveLength(2);
    expect(result.total.estimatedBytes).toBe(191 * GIB);
    expect(result.summary).toContain("2 panels (2 priced)");
    expect(result.summary).toContain("per full refresh");
    expect(result.summary).toContain("if its email reports use these filters");
    expect(result.summary).toContain('"Big"');
    expect(result.summary).not.toContain('"Small"');
  });

  it("counts report schedules on seed dashboards in the caller's org", async () => {
    mocks.getDashboard.mockResolvedValueOnce(null);
    mocks.loadDashboardSeed.mockReturnValueOnce({ panels: [] });
    mocks.countReports.mockResolvedValueOnce(1);
    mocks.resolvePanels.mockReturnValueOnce([
      {
        panelId: "small",
        title: "Small",
        source: "bigquery",
        query: "SELECT 1",
      },
    ]);

    const result = await run({ dashboardId: "seed-dashboard" });

    expect(mocks.countReports).toHaveBeenCalledWith("seed-dashboard", {
      email: "caller@example.test",
      orgId: "org-1",
    });
    expect(result.runsPerMonth).toBe(30);
  });

  it("skips panels left when the time budget runs out", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0);
    now.mockReturnValue(60_000);
    mocks.getDashboard.mockResolvedValueOnce({ kind: "sql", config: {} });
    mocks.resolvePanels.mockReturnValueOnce([
      {
        panelId: "small",
        title: "Small",
        source: "bigquery",
        query: "SELECT 1",
      },
    ]);

    const result = await run({ dashboardId: "d1" });
    now.mockRestore();

    expect(mocks.estimateResolvedPanel).not.toHaveBeenCalled();
    expect(result.panels[0]).toMatchObject({
      status: "failed",
      failure: "timeout",
    });
    expect(result.summary).toContain("1 panel could not be estimated");
    expect(result.summary).not.toContain("full refresh");
    expect(result.summary).toContain("1 panel: none could be priced.");
    expect(result.summary).not.toContain("none read BigQuery");
  });

  it("stops waiting on a panel when the deadline passes mid-estimate", async () => {
    vi.useFakeTimers();
    try {
      mocks.getDashboard.mockResolvedValueOnce({ kind: "sql", config: {} });
      mocks.resolvePanels.mockReturnValueOnce([
        {
          panelId: "slow",
          title: "Slow",
          source: "bigquery",
          query: "SELECT 1",
        },
      ]);
      let panelSignal: AbortSignal | undefined;
      mocks.estimateResolvedPanel.mockImplementationOnce(
        (_panel, _scope, _runs, received: AbortSignal) => {
          panelSignal = received;
          return new Promise(() => {});
        },
      );

      const pending = run({ dashboardId: "d1" });
      await vi.advanceTimersByTimeAsync(41_000);
      const result = await pending;

      expect(result.panels[0]).toMatchObject({
        status: "failed",
        failure: "timeout",
      });
      expect(panelSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns when the dashboard total crosses a threshold no panel does", async () => {
    mocks.getDashboard.mockResolvedValueOnce({ kind: "sql", config: {} });
    mocks.resolvePanels.mockReturnValueOnce(
      ["a", "b"].map((panelId) => ({
        panelId,
        title: panelId,
        source: "bigquery",
        query: "SELECT 1",
      })),
    );
    mocks.estimateResolvedPanel.mockImplementation(async (panel) => ({
      panelId: panel.panelId,
      title: panel.title,
      source: panel.source,
      ...costFromBytes(100 * GIB, null),
    }));

    const result = await run({ dashboardId: "d1" });

    expect(result.total).toMatchObject({
      overPerRunThreshold: true,
      overPerMonthThreshold: false,
      partial: false,
    });
    expect(result.summary).toContain(
      "The dashboard as a whole is over the $1.00/run threshold.",
    );
    expect(result.summary).not.toContain("Over threshold:");
  });

  it("treats a null or empty run count as not given", async () => {
    mocks.getDashboard.mockResolvedValue({ kind: "sql", config: {} });
    mocks.countReports.mockResolvedValue(1);
    mocks.resolvePanels.mockReturnValue([
      {
        panelId: "small",
        title: "Small",
        source: "bigquery",
        query: "SELECT 1",
      },
    ]);

    for (const runsPerMonth of [null, ""]) {
      const result = await run({ dashboardId: "d1", runsPerMonth });
      expect(result.runsPerMonth).toBe(30);
      expect(result.runsPerMonthBasis).toBe("1 enabled daily email report");
    }
  });

  it("says when program panels leave the total partial", async () => {
    mocks.getDashboard.mockResolvedValueOnce({ kind: "sql", config: {} });
    mocks.resolvePanels.mockReturnValueOnce([
      {
        panelId: "small",
        title: "Small",
        source: "bigquery",
        query: "SELECT 1",
      },
      { panelId: "prog", title: "Prog", source: "program", query: "{}" },
    ]);
    mocks.estimateResolvedPanel.mockImplementation(async (panel) =>
      panel.source === "program"
        ? {
            panelId: panel.panelId,
            title: panel.title,
            source: panel.source,
            status: "not_estimated",
            reason: "program",
          }
        : {
            panelId: panel.panelId,
            title: panel.title,
            source: panel.source,
            ...costFromBytes(GIB, null),
          },
    );

    const result = await run({ dashboardId: "d1" });

    expect(result.summary).toContain("per refresh of the priced panels only");
    expect(result.summary).toContain(
      "1 panel may read BigQuery but isn't priced here.",
    );
  });

  it("estimates one panel and reports unknown panel ids", async () => {
    mocks.getDashboard.mockResolvedValue({ kind: "sql", config: {} });
    mocks.resolvePanels.mockReturnValue([
      {
        panelId: "small",
        title: "Small",
        source: "bigquery",
        query: "SELECT 1",
      },
      { panelId: "big", title: "Big", source: "bigquery", query: "SELECT 2" },
    ]);

    const one = await run({ dashboardId: "d1", panelId: "small" });
    expect(one.panels.map((p: { panelId: string }) => p.panelId)).toEqual([
      "small",
    ]);
    expect(one.runsPerMonth).toBeNull();

    await expect(
      run({ dashboardId: "d1", panelId: "nope" }),
    ).rejects.toMatchObject({ errorCode: "panel_not_found", statusCode: 404 });
  });
});
