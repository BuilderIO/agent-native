import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getRequestOrgId: vi.fn((): string | undefined => "org-a"),
  getRequestUserEmail: vi.fn((): string | undefined => "member@example.test"),
  registerBuiltinEngines: vi.fn(),
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  detectEngineFromEnv: vi.fn(() => null),
  detectEngineFromUserSecrets: vi.fn(async () => null),
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

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => mocks.getRequestOrgId(),
  getRequestUserEmail: () => mocks.getRequestUserEmail(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/usage", () => ({
  getUsageSummary: vi.fn(),
  usageBillingForEngine: vi.fn(),
}));

vi.mock("@agent-native/dispatch/actions", () => ({
  dispatchActions: {},
}));

const { listDispatchUsageMetricsScoped } = await import("./usage-metrics.js");

afterEach(() => {
  vi.clearAllMocks();
  mocks.getRequestOrgId.mockReturnValue("org-a");
  mocks.getRequestUserEmail.mockReturnValue("member@example.test");
});

describe("listDispatchUsageMetricsScoped", () => {
  it("rejects non-admin organization members with a typed 403", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ role: "member" }] });

    await expect(
      listDispatchUsageMetricsScoped({ sinceDays: 30 }),
    ).rejects.toMatchObject({
      name: "ForbiddenError",
      statusCode: 403,
      message:
        "Only organization owners and admins can view workspace usage metrics.",
    });
  });
});
