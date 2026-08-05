import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));

const action = (await import("./query-agent-native-analytics")).default;

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.queryFirstPartyAnalytics.mockReset();
  mocks.getRequestOrgId.mockReturnValue("org_123");
  mocks.getRequestUserEmail.mockReturnValue("alice@example.com");
  mocks.queryFirstPartyAnalytics.mockResolvedValue({
    rows: [{ events: 3 }],
    schema: [{ name: "events", type: "number" }],
  });
});

describe("query-agent-native-analytics", () => {
  it("enables the tenant-scoped result cache for agent queries", async () => {
    const sql =
      "SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups GROUP BY event_date, event_name";

    await expect(action.run({ sql })).resolves.toEqual({
      rows: [{ events: 3 }],
      schema: [{ name: "events", type: "number" }],
    });
    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      sql,
      { userEmail: "alice@example.com", orgId: "org_123" },
      { cache: true },
    );
  });

  it("teaches the agent to prefer rollups and bound raw reads", () => {
    expect(action.description).toContain("analytics_event_daily_rollups");
    expect(action.description).toContain("analytics_user_days");
    expect(action.description).toMatch(
      /updated transactionally with new ingest/i,
    );
    expect(action.description).toMatch(
      /not automatically backfilled from existing analytics_events/i,
    );
    expect(action.description).toMatch(/bounded recent drill-downs/i);
    expect(action.description).toMatch(/all-time|lifetime/i);
    expect(action.schema.shape.sql.description).toMatch(
      /unbounded raw-event scan/i,
    );
  });
});
