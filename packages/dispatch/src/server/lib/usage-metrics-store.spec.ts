import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectEngineFromEnv: vi.fn(() => null),
  detectEngineFromUserSecrets: vi.fn(async () => null),
  execute: vi.fn(),
  getSetting: vi.fn(async () => null),
  getUsageSummary: vi.fn(),
  listWorkspaceApps: vi.fn(),
  registerBuiltinEngines: vi.fn(),
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  detectEngineFromEnv: (...args: any[]) => mocks.detectEngineFromEnv(...args),
  detectEngineFromUserSecrets: (...args: any[]) =>
    mocks.detectEngineFromUserSecrets(...args),
  getAgentEngineEntry: vi.fn(() => null),
  isAgentEngineSettingConfigured: vi.fn(() => false),
  isStoredEngineUsable: vi.fn(() => false),
  registerBuiltinEngines: () => mocks.registerBuiltinEngines(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: (...args: any[]) => mocks.execute(...args),
  }),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: (...args: any[]) => mocks.getSetting(...args),
}));

vi.mock("@agent-native/core/usage", () => ({
  getUsageSummary: (...args: any[]) => mocks.getUsageSummary(...args),
  usageBillingForEngine: () => ({
    unit: "usd",
    label: "Estimated spend",
    shortLabel: "Cost",
    source: "estimated-provider-cost",
  }),
}));

vi.mock("./app-creation-store.js", () => ({
  listWorkspaceApps: (...args: any[]) => mocks.listWorkspaceApps(...args),
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: () => null,
  currentOwnerEmail: () => "owner@example.test",
}));

const { listDispatchUsageMetrics } = await import("./usage-metrics-store.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("listDispatchUsageMetrics", () => {
  it("returns empty metrics when usage storage bootstrap and reads fail", async () => {
    mocks.getUsageSummary.mockRejectedValue(new Error("database is locked"));
    mocks.execute.mockRejectedValue(new Error("no such table: token_usage"));
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "dispatch",
        name: "Dispatch",
        path: "/dispatch",
        status: "ready",
        isDispatch: true,
      },
    ]);

    const metrics = await listDispatchUsageMetrics({ sinceDays: 30 });

    expect(mocks.getUsageSummary).toHaveBeenCalledWith({
      ownerEmail: "__dispatch_metrics_init__",
      sinceMs: expect.any(Number),
    });
    expect(metrics.access).toEqual({
      viewerEmail: "owner@example.test",
      orgId: null,
      role: null,
      scope: "solo",
      totalUsers: 0,
    });
    expect(metrics.totals).toEqual({
      costCents: 0,
      calls: 0,
      chatCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      activeUsers: 0,
      chatThreads: 0,
      chatMessages: 0,
      workspaceApps: 0,
    });
    expect(metrics.byUser).toEqual([]);
    expect(metrics.recent).toEqual([]);
    expect(metrics.appAccess).toHaveLength(1);
  });
});
