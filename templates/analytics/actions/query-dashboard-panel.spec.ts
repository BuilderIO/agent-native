import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContext: vi.fn(),
  normalizeDashboardPanelQuery: vi.fn(),
  resolveAnalyticsPanelSource: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));

vi.mock("../server/lib/dashboard-panel-query", () => ({
  DASHBOARD_PANEL_SOURCES: ["bigquery", "demo", "program"],
  normalizeDashboardPanelQuery: mocks.normalizeDashboardPanelQuery,
}));

vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolveAnalyticsPanelSource,
}));

const { default: queryDashboardPanel } =
  await import("./query-dashboard-panel");
const { BigQueryMaximumBytesBilledError } =
  await import("../server/lib/bigquery");

describe("query-dashboard-panel", () => {
  beforeEach(() => {
    mocks.getCredentialContext.mockReset();
    mocks.normalizeDashboardPanelQuery.mockReset();
    mocks.resolveAnalyticsPanelSource.mockReset();
  });

  it("preserves the dashboard panel wire shape through the source registry", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    const descriptor = { promql: "up", mode: "instant" };
    const query = JSON.stringify(descriptor);
    const result = {
      rows: [{ timestamp: "2026-07-21T00:00:00.000Z", value: 1 }],
      schema: [
        { name: "timestamp", type: "string" },
        { name: "value", type: "number" },
      ],
    };
    mocks.getCredentialContext.mockReturnValue(context);
    mocks.normalizeDashboardPanelQuery.mockReturnValue(query);
    mocks.resolveAnalyticsPanelSource.mockResolvedValue(result);

    await expect(
      queryDashboardPanel.run({ source: "demo", query: descriptor }),
    ).resolves.toEqual(result);
    expect(mocks.normalizeDashboardPanelQuery).toHaveBeenCalledWith(
      "demo",
      descriptor,
    );
    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      { source: "demo", query },
      context,
    );
  });

  it("keeps this rendering transport out of the agent tool catalog", () => {
    expect(queryDashboardPanel.agentTool).toBe(false);
    expect(queryDashboardPanel.readOnly).toBe(true);
  });

  it("passes an explicit refresh request through to the configured source", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    const query = "SELECT 1";
    mocks.getCredentialContext.mockReturnValue(context);
    mocks.normalizeDashboardPanelQuery.mockReturnValue(query);
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [],
      schema: [],
    });

    await queryDashboardPanel.run({
      source: "bigquery",
      query,
      forceRefresh: true,
    });

    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      { source: "bigquery", query, forceRefresh: true },
      context,
    );
  });

  it("forwards action cancellation to the source resolver", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    const signal = new AbortController().signal;
    mocks.getCredentialContext.mockReturnValue(context);
    mocks.normalizeDashboardPanelQuery.mockReturnValue("SELECT 1");
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [],
      schema: [],
    });

    await queryDashboardPanel.run({ source: "bigquery", query: "SELECT 1" }, {
      caller: "frontend",
      signal,
    } as ActionRunContext);

    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      { source: "bigquery", query: "SELECT 1", signal },
      context,
    );
  });

  it("requires the authenticated credential context used by panel sources", async () => {
    mocks.getCredentialContext.mockReturnValue(null);

    await expect(
      queryDashboardPanel.run({ source: "demo", query: "up" }),
    ).rejects.toThrow(/No authenticated context/);
  });

  it("caps a row breakdown at the server's fixed byte budget", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    mocks.getCredentialContext.mockReturnValue(context);
    mocks.normalizeDashboardPanelQuery.mockReturnValue("SELECT 1");
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [],
      schema: [],
    });

    await queryDashboardPanel.run({
      source: "bigquery",
      query: "SELECT 1",
      purpose: "row-breakdown",
    });

    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      {
        source: "bigquery",
        query: "SELECT 1",
        maxBytesBilled: 50 * 1024 ** 3,
      },
      context,
    );
  });

  it("caps record drill-downs and preserves their over-cap error", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    const signal = new AbortController().signal;
    mocks.getCredentialContext.mockReturnValue(context);
    mocks.normalizeDashboardPanelQuery.mockReturnValue(
      "SELECT visitor FROM events LIMIT 500",
    );
    const error = new BigQueryMaximumBytesBilledError(400);
    mocks.resolveAnalyticsPanelSource.mockRejectedValue(error);
    await expect(
      queryDashboardPanel.run(
        {
          source: "bigquery",
          query: "SELECT visitor FROM events LIMIT 500",
          purpose: "panel-drilldown",
        },
        { caller: "frontend", signal } as ActionRunContext,
      ),
    ).rejects.toBe(error);
    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      {
        source: "bigquery",
        query: "SELECT visitor FROM events LIMIT 500",
        maxBytesBilled: 50 * 1024 ** 3,
        signal,
      },
      context,
    );
  });

  it("reports a breakdown over its byte cap as that, not as a failed panel", async () => {
    mocks.getCredentialContext.mockReturnValue({ userEmail: "a@example.com" });
    mocks.normalizeDashboardPanelQuery.mockReturnValue("SELECT 1");
    mocks.resolveAnalyticsPanelSource.mockRejectedValue(
      new BigQueryMaximumBytesBilledError(400),
    );

    await expect(
      queryDashboardPanel.run({
        source: "bigquery",
        query: "SELECT 1",
        purpose: "row-breakdown",
      }),
    ).resolves.toMatchObject({ error: "breakdown_over_byte_cap" });
  });

  it("leaves a normal panel load uncapped by the breakdown budget", async () => {
    mocks.getCredentialContext.mockReturnValue({ userEmail: "a@example.com" });
    mocks.normalizeDashboardPanelQuery.mockReturnValue("SELECT 1");
    const error = new BigQueryMaximumBytesBilledError(400);
    mocks.resolveAnalyticsPanelSource.mockRejectedValue(error);

    await expect(
      queryDashboardPanel.run({ source: "bigquery", query: "SELECT 1" }),
    ).rejects.toBe(error);
    expect(
      mocks.resolveAnalyticsPanelSource.mock.calls[0][0],
    ).not.toHaveProperty("maxBytesBilled");
  });
});
