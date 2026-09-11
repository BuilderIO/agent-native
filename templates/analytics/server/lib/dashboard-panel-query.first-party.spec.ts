import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("./first-party-analytics", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));

import { runDashboardPanelQuery } from "./dashboard-panel-query";
import { FirstPartyAnalyticsUnsupportedSqlError } from "./first-party-analytics-backend";

const ctx = { userEmail: "alice@example.com", orgId: "org-1" };

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

  it("returns a typed unsupported-backend state that is not an empty result", async () => {
    mocks.queryFirstPartyAnalytics.mockRejectedValue(
      new FirstPartyAnalyticsUnsupportedSqlError(
        "date_trunc('month', ...)",
        "First-party BigQuery query only supports PostgreSQL date_trunc('week', ...) expressions",
      ),
    );

    const result = (await runDashboardPanelQuery({
      source: "first-party",
      query:
        "SELECT date_trunc('month', event_date) AS d FROM analytics_events",
      ctx,
    })) as unknown as Record<string, unknown>;

    expect(result.error).toBe("unsupported_by_backend");
    expect(result.backend).toBe("bigquery");
    expect(result.construct).toBe("date_trunc('month', ...)");
    expect(result.message).toContain("date_trunc('month', ...)");
    // The whole point: an unrunnable panel must never look like a query that
    // ran and matched nothing.
    expect(result).not.toHaveProperty("rows");
  });

  it("still throws every other first-party query failure", async () => {
    mocks.queryFirstPartyAnalytics.mockRejectedValue(
      new Error("statement timeout"),
    );

    await expect(
      runDashboardPanelQuery({
        source: "first-party",
        query: "SELECT COUNT(*) AS count FROM analytics_events",
        ctx,
      }),
    ).rejects.toThrow("statement timeout");
  });
});
