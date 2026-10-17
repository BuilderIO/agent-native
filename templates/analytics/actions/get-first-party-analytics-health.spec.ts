import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getHealth: vi.fn(),
  unavailable: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/first-party-analytics-health.js", () => ({
  getFirstPartyAnalyticsHealth: mocks.getHealth,
  unavailableFirstPartyAnalyticsHealth: mocks.unavailable,
}));

const action = (await import("./get-first-party-analytics-health")).default;

const bigQuery = {
  id: "bigquery",
  label: "BigQuery",
  role: "warehouse",
  configured: false,
  missingRequiredKeys: ["BIGQUERY_PROJECT_ID"],
  setupLink: "/data-sources?source=bigquery",
} as const;

function healthResult(status: "healthy" | "unavailable") {
  return {
    status,
    recommendation: "none",
    externalBackendRecommendation: status === "healthy" ? "none" : "unknown",
    externalBackends: [
      bigQuery,
      {
        id: "amplitude",
        label: "Amplitude",
        role: "product-analytics",
        configured: null,
        missingRequiredKeys: [],
        setupLink: "/data-sources?source=amplitude",
      },
    ],
    reasons: [],
    observedAt: "2026-10-06T12:00:00.000Z",
    metrics: {
      eventCount: 10,
      dailyRollupRows: 2,
      firstEventDate: "2026-10-05",
      lastEventDate: null,
      spanDays: 1,
      slowQueryCount24h: 0,
      timeoutCount24h: 0,
      errorCount24h: 0,
      maxQueryDurationMs24h: 0,
    },
    thresholds: {
      slowQueryMs: 5_000,
      recommendEventCount: 1_000_000,
      recommendSlowQueries24h: 3,
      recommendMaxQueryMs: 30_000,
    },
    delivery: {
      pendingCount: 0,
      oldestPendingAt: null,
      lastDeliveredAt: null,
      lastError: null,
    },
    bigQuery,
  };
}

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.getHealth.mockReset();
  mocks.unavailable.mockReset();
  mocks.getRequestOrgId.mockReturnValue("org_123");
  mocks.getRequestUserEmail.mockReturnValue("alice@example.com");
  mocks.getHealth.mockResolvedValue(healthResult("healthy"));
  mocks.unavailable.mockReturnValue(healthResult("unavailable"));
});

describe("get-first-party-analytics-health", () => {
  it("passes the request scope to the health reader", async () => {
    await expect(action.run({})).resolves.toEqual(healthResult("healthy"));
    expect(mocks.getHealth).toHaveBeenCalledWith({
      userEmail: "alice@example.com",
      orgId: "org_123",
    });
  });

  it("does not turn a health read failure into a healthy result", async () => {
    mocks.getHealth.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(action.run({})).resolves.toEqual(healthResult("unavailable"));
    expect(mocks.unavailable).toHaveBeenCalledTimes(1);
  });

  it("advertises its audited output contract to MCP clients", () => {
    expect(action.mcpOutputContract?.response).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["status", "metrics", "delivery"]),
    });
  });

  it("rejects a health result that breaks its contract instead of passing it on", async () => {
    mocks.getHealth.mockResolvedValueOnce({ status: "healthy" });

    await expect(action.run({})).rejects.toMatchObject({
      errorCode: "output_contract_violation",
      effect: "none",
    });
  });

  it("requires an authenticated request", async () => {
    mocks.getRequestUserEmail.mockReturnValueOnce(null);

    await expect(action.run({})).rejects.toThrow("no authenticated user");
    expect(mocks.getHealth).not.toHaveBeenCalled();
  });
});
