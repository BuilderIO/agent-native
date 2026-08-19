import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectEngineFromEnv: vi.fn(() => null),
  detectEngineFromUserSecrets: vi.fn(async () => null),
  execute: vi.fn(),
  getSetting: vi.fn(async () => null),
  getUsageSummary: vi.fn(),
  listWorkspaceApps: vi.fn(),
  currentOrgId: vi.fn((): string | null => null),
  currentOwnerEmail: vi.fn(() => "owner@example.test"),
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
  currentOrgId: () => mocks.currentOrgId(),
  currentOwnerEmail: () => mocks.currentOwnerEmail(),
}));

const { listDispatchUsageMetrics } = await import("./usage-metrics-store.js");

afterEach(() => {
  vi.clearAllMocks();
  mocks.currentOrgId.mockReturnValue(null);
  mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
});

describe("listDispatchUsageMetrics", () => {
  it("rejects non-admin organization members with a typed 403", async () => {
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("member@example.test");
    mocks.execute.mockResolvedValue({ rows: [{ role: "member" }] });

    await expect(
      listDispatchUsageMetrics({ sinceDays: 30 }),
    ).rejects.toMatchObject({
      name: "ForbiddenError",
      statusCode: 403,
      message:
        "Only organization owners and admins can view workspace usage metrics.",
    });
    expect(mocks.getUsageSummary).not.toHaveBeenCalled();
    expect(mocks.listWorkspaceApps).not.toHaveBeenCalled();
  });

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

  it("allows personal scope and hydrates a linked thread prompt", async () => {
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT id, created_at")) {
        return {
          rows: [
            {
              id: 7,
              created_at: Date.now(),
              owner_email: "owner@example.test",
              app: "dispatch",
              label: "chat",
              model: "test-model",
              input_tokens: 10,
              output_tokens: 20,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              cost_cents_x100: 250,
              thread_id: "thread-1",
              run_id: "run-1",
              task_id: null,
              source_platform: "dispatch",
              source_id: "dispatch",
            },
          ],
        };
      }
      if (sql.includes("FROM chat_threads WHERE id IN")) {
        return {
          rows: [
            {
              id: "thread-1",
              preview: "Fallback preview",
              thread_data: JSON.stringify({
                messages: [
                  {
                    message: {
                      role: "user",
                      content: "Find the repeated background work.",
                    },
                  },
                ],
              }),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const metrics = await listDispatchUsageMetrics({
      sinceDays: 7,
      scope: "me",
    });

    expect(metrics.viewScope).toBe("me");
    expect(metrics.recent[0]).toMatchObject({
      prompt: "Find the repeated background work.",
      promptSource: "thread",
      threadId: "thread-1",
      runId: "run-1",
    });
    expect(
      mocks.execute.mock.calls.some(([query]) =>
        String((query as { sql?: string }).sql).includes(
          "LOWER(owner_email) = ?",
        ),
      ),
    ).toBe(true);
  });

  it("filters workspace usage and prompts to a selected member", async () => {
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "owner" }] };
      }
      if (sql.includes("SELECT email, role, joined_at")) {
        return {
          rows: [
            { email: "owner@example.test", role: "owner", joined_at: null },
            { email: "member@example.test", role: "member", joined_at: null },
          ],
        };
      }
      return { rows: [] };
    });

    const metrics = await listDispatchUsageMetrics({
      sinceDays: 30,
      scope: "workspace",
      userEmail: "member@example.test",
    });

    expect(metrics.selectedUserEmail).toBe("member@example.test");
    expect(metrics.availableUsers).toEqual([
      { email: "member@example.test", role: "member" },
      { email: "owner@example.test", role: "owner" },
    ]);
    expect(
      mocks.execute.mock.calls.some(([query]) => {
        const sql = String((query as { sql?: string }).sql);
        const args = (query as { args?: unknown[] }).args ?? [];
        return (
          sql.includes("LOWER(owner_email) = ?") &&
          args.includes("member@example.test")
        );
      }),
    ).toBe(true);
  });
});
