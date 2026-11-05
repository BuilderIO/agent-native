import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
}));
vi.mock("../server/lib/first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));

const { default: getTrafficCounts } = await import("./get-traffic-counts");

describe("get-traffic-counts", () => {
  beforeEach(() => {
    mocks.queryFirstPartyAnalytics.mockReset();
  });

  it("reports each count over the days asked for, in the caller's scope", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [{ production_events: "12", beta_events: 3, unknown_events: 2 }],
      schema: [],
    });

    await expect(getTrafficCounts.run({ days: 30 })).resolves.toEqual({
      days: 30,
      production: 12,
      beta: 3,
      unknown: 2,
    });
    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      expect.stringContaining("FROM analytics_events"),
      { userEmail: "owner@example.com", orgId: "org-1" },
      { cache: true },
    );
  });

  it("fails rather than reporting no unknown traffic when a count can't be read", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [{ production_events: 1, beta_events: 1, unknown_events: "?" }],
      schema: [],
    });

    await expect(getTrafficCounts.run({})).rejects.toThrow(
      "unreadable unknown_events",
    );
  });
});
