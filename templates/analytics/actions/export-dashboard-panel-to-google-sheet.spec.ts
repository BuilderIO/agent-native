import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContext: vi.fn(),
  getDashboard: vi.fn(),
  normalizeDashboardPanelQuery: vi.fn(),
  resolveAnalyticsPanelSource: vi.fn(),
  exportDashboardPanelToGoogleSheet: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));

vi.mock("../server/lib/dashboard-panel-query", () => ({
  isDashboardPanelSource: (value: unknown) =>
    value === "bigquery" || value === "first-party",
  normalizeDashboardPanelQuery: mocks.normalizeDashboardPanelQuery,
}));

vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolveAnalyticsPanelSource,
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
}));

vi.mock("../server/lib/google-sheets-export", () => ({
  exportDashboardPanelToGoogleSheet: mocks.exportDashboardPanelToGoogleSheet,
}));

const { default: exportDashboardPanelToGoogleSheet } =
  await import("./export-dashboard-panel-to-google-sheet");

describe("export-dashboard-panel-to-google-sheet", () => {
  const context = { userEmail: "alice@example.com", orgId: "org-1" };
  const dashboard = {
    id: "dashboard-1",
    kind: "sql",
    title: "Revenue",
    config: {
      panels: [
        {
          id: "table-1",
          title: "Recent orders",
          sql: "SELECT * FROM orders",
          source: "bigquery",
          chartType: "table",
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentialContext.mockReturnValue(context);
    mocks.getDashboard.mockResolvedValue(dashboard);
    mocks.normalizeDashboardPanelQuery.mockReturnValue("normalized-query");
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [{ order_id: "order-1", total: 42 }],
      schema: [
        { name: "order_id", type: "string" },
        { name: "total", type: "number" },
      ],
      truncated: false,
    });
    mocks.exportDashboardPanelToGoogleSheet.mockResolvedValue({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      spreadsheetId: "sheet-1",
      rowCount: 1,
      metadata: { panelId: "table-1" },
    });
  });

  it("checks dashboard access, reuses the panel resolver, and exports structured results", async () => {
    const result = await exportDashboardPanelToGoogleSheet.run({
      dashboardId: "dashboard-1",
      panelId: "table-1",
    });

    expect(mocks.getDashboard).toHaveBeenCalledWith("dashboard-1", {
      email: "alice@example.com",
      orgId: "org-1",
    });
    expect(mocks.normalizeDashboardPanelQuery).toHaveBeenCalledWith(
      "bigquery",
      "SELECT * FROM orders",
    );
    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      { source: "bigquery", query: "normalized-query" },
      context,
    );
    expect(mocks.exportDashboardPanelToGoogleSheet).toHaveBeenCalledWith({
      dashboardId: "dashboard-1",
      dashboardTitle: "Revenue",
      panelId: "table-1",
      panelTitle: "Recent orders",
      source: "bigquery",
      rows: [{ order_id: "order-1", total: 42 }],
      schema: [
        { name: "order_id", type: "string" },
        { name: "total", type: "number" },
      ],
      truncated: false,
      bytesProcessed: undefined,
    });
    expect(result).toEqual({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      spreadsheetId: "sheet-1",
      rowCount: 1,
      metadata: { panelId: "table-1" },
    });
  });

  it("applies the dashboard's current filter variables before querying", async () => {
    mocks.getDashboard.mockResolvedValue({
      ...dashboard,
      config: {
        panels: [
          {
            ...dashboard.config.panels[0],
            sql: "SELECT * FROM orders WHERE region = '{{region}}'",
          },
        ],
      },
    });

    await exportDashboardPanelToGoogleSheet.run({
      dashboardId: "dashboard-1",
      panelId: "table-1",
      filters: { region: "US" },
    });

    expect(mocks.normalizeDashboardPanelQuery).toHaveBeenCalledWith(
      "bigquery",
      "SELECT * FROM orders WHERE region = 'US'",
    );
  });

  it("rejects inaccessible or non-SQL dashboards", async () => {
    mocks.getDashboard.mockResolvedValue(null);

    await expect(
      exportDashboardPanelToGoogleSheet.run({
        dashboardId: "private-dashboard",
        panelId: "table-1",
      }),
    ).rejects.toMatchObject({
      message: "Dashboard not found",
      statusCode: 404,
    });
  });

  it("rejects non-table panels before running their query", async () => {
    mocks.getDashboard.mockResolvedValue({
      ...dashboard,
      config: {
        panels: [{ ...dashboard.config.panels[0], chartType: "bar" }],
      },
    });

    await expect(
      exportDashboardPanelToGoogleSheet.run({
        dashboardId: "dashboard-1",
        panelId: "table-1",
      }),
    ).rejects.toThrow("Only table dashboard panels can be exported");
    expect(mocks.resolveAnalyticsPanelSource).not.toHaveBeenCalled();
  });

  it("surfaces missing source credentials without creating a sheet", async () => {
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      error: "missing_api_key",
      message: "Connect your BigQuery account to see this data",
    });

    await expect(
      exportDashboardPanelToGoogleSheet.run({
        dashboardId: "dashboard-1",
        panelId: "table-1",
      }),
    ).rejects.toThrow("Connect your BigQuery account");
    expect(mocks.exportDashboardPanelToGoogleSheet).not.toHaveBeenCalled();
  });

  it("requires approval and keeps arbitrary provider writes out of extensions", () => {
    expect(exportDashboardPanelToGoogleSheet.needsApproval).toBe(true);
    expect(exportDashboardPanelToGoogleSheet.toolCallable).toBe(false);
  });
});
