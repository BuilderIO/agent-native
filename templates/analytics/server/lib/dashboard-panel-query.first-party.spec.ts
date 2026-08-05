import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("./first-party-analytics", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));

import { runDashboardPanelQuery } from "./dashboard-panel-query";

describe("dashboard-panel-query: first-party source", () => {
  beforeEach(() => {
    mocks.queryFirstPartyAnalytics.mockReset();
  });

  it("uses the report panel timeout for the scoped cached query", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [{ count: 1 }],
      schema: [{ name: "count", type: "number" }],
    });

    await runDashboardPanelQuery({
      source: "first-party",
      query: "SELECT COUNT(*) AS count FROM analytics_events",
      ctx: { userEmail: "alice@example.com", orgId: "org-1" },
      timeoutMs: 147,
    });

    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      "SELECT COUNT(*) AS count FROM analytics_events",
      {
        userEmail: "alice@example.com",
        orgId: "org-1",
      },
      {
        cache: true,
        timeoutMs: 147,
      },
    );
  });
});
