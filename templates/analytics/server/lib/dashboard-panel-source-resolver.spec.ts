import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDashboardPanelQuery: vi.fn(),
}));

vi.mock("./dashboard-panel-query", () => ({
  DASHBOARD_PANEL_SOURCES: ["demo", "program"],
  runDashboardPanelQuery: mocks.runDashboardPanelQuery,
}));

import {
  analyticsPanelSourceResolvers,
  resolveAnalyticsPanelSource,
} from "./dashboard-panel-source-resolver";

describe("Analytics dashboard panel source resolver registry", () => {
  beforeEach(() => {
    mocks.runDashboardPanelQuery.mockReset();
  });

  it("resolves a request through its registered source", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    const result = {
      rows: [{ value: 1 }],
      schema: [{ name: "value", type: "number" }],
    };
    mocks.runDashboardPanelQuery.mockResolvedValue(result);

    await expect(
      resolveAnalyticsPanelSource({ source: "demo", query: "up" }, context),
    ).resolves.toEqual(result);
    expect(mocks.runDashboardPanelQuery).toHaveBeenCalledWith({
      source: "demo",
      query: "up",
      ctx: context,
    });
    expect(
      analyticsPanelSourceResolvers.map((resolver) => resolver.source),
    ).toEqual(["demo", "program"]);
  });

  it("passes a panel timeout through to the Analytics query runner", async () => {
    const context = { userEmail: "alice@example.com", orgId: "org-1" };
    mocks.runDashboardPanelQuery.mockResolvedValue({
      rows: [],
      schema: [],
    });

    await resolveAnalyticsPanelSource(
      { source: "demo", query: "up", timeoutMs: 147 },
      context,
    );

    expect(mocks.runDashboardPanelQuery).toHaveBeenCalledWith({
      source: "demo",
      query: "up",
      ctx: context,
      timeoutMs: 147,
    });
  });

  it("fails loudly when no source resolver is registered", async () => {
    await expect(
      resolveAnalyticsPanelSource(
        { source: "missing" as "demo", query: "" },
        { userEmail: "alice@example.com", orgId: null },
      ),
    ).rejects.toThrow("Unsupported dashboard panel source: missing");
  });
});
