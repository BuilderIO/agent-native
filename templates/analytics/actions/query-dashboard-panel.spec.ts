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
  DASHBOARD_PANEL_SOURCES: ["demo", "program"],
  normalizeDashboardPanelQuery: mocks.normalizeDashboardPanelQuery,
}));

vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolveAnalyticsPanelSource,
}));

const { default: queryDashboardPanel } =
  await import("./query-dashboard-panel");

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

  it("requires the authenticated credential context used by panel sources", async () => {
    mocks.getCredentialContext.mockReturnValue(null);

    await expect(
      queryDashboardPanel.run({ source: "demo", query: "up" }),
    ).rejects.toThrow(/No authenticated context/);
  });
});
