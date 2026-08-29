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
  builderCreditsFromCostCents: (cents: number) => cents / 4,
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
      totalUsers: 1,
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

  it("keeps an unaffiliated workspace request scoped to the signed-in user", async () => {
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([]);
    mocks.execute.mockResolvedValue({ rows: [] });

    const metrics = await listDispatchUsageMetrics({
      sinceDays: 30,
      scope: "workspace",
    });

    expect(metrics.access).toMatchObject({
      viewerEmail: "owner@example.test",
      orgId: null,
      scope: "solo",
      totalUsers: 1,
    });
    const scopedTokenQueries = mocks.execute.mock.calls
      .map(([query]) => String((query as { sql?: string }).sql))
      .filter(
        (sql) => sql.includes("FROM token_usage") && sql.includes("WHERE"),
      );
    expect(scopedTokenQueries.length).toBeGreaterThan(0);
    expect(
      scopedTokenQueries.every((sql) =>
        sql.includes("LOWER(owner_email) IN (?)"),
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

  it("lets an app owner inspect aggregate adoption for their own app", async () => {
    const now = Date.now();
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "orders",
        name: "Orders",
        path: "/orders",
        status: "ready",
        isDispatch: false,
        owner: "owner@example.test",
        visibility: "org",
      },
      {
        id: "support",
        name: "Support",
        path: "/support",
        status: "ready",
        isDispatch: false,
        owner: "other@example.test",
        visibility: "org",
      },
    ]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email, role, joined_at")) {
        return {
          rows: [
            { email: "owner@example.test", role: "member", joined_at: null },
            { email: "member@example.test", role: "member", joined_at: null },
          ],
        };
      }
      if (
        sql.includes("FROM token_usage") &&
        sql.includes("ORDER BY created_at ASC")
      ) {
        return {
          rows: [
            {
              created_at: now - 2 * 86_400_000,
              owner_email: "owner@example.test",
              app: "orders",
              label: "create-order",
              cost_cents_x100: 100,
            },
            {
              created_at: now - 60 * 60_000,
              owner_email: "member@example.test",
              app: "agent-native-orders",
              label: "create-order",
              cost_cents_x100: 200,
            },
            {
              created_at: now - 60 * 60_000,
              owner_email: "member@example.test",
              app: "orders",
              label: "approve-order",
              cost_cents_x100: 300,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const metrics = await listDispatchUsageMetrics({
      sinceDays: 30,
      scope: "app",
      appId: "orders",
    });

    expect(metrics).toMatchObject({
      viewScope: "app",
      selectedAppId: "orders",
      byUser: [],
      recent: [],
      monthlyByUser: [],
      availableUsers: [],
    });
    expect(metrics.totals.workspaceApps).toBe(2);
    expect(metrics.appAccess[0]).toMatchObject({
      id: "orders",
      ownerEmail: "owner@example.test",
      isOwnedByViewer: true,
      canViewUsage: true,
      usersWithUsage: 2,
      dailyActiveUsers: 1,
      weeklyActiveUsers: 2,
      usageCalls: 3,
      costCents: 6,
    });
    expect(metrics.appAccess[0].actionMetrics).toEqual([
      {
        key: "create-order",
        label: "create-order",
        calls: 2,
        activeUsers: 2,
        lastActiveAt: expect.any(Number),
      },
      {
        key: "approve-order",
        label: "approve-order",
        calls: 1,
        activeUsers: 1,
        lastActiveAt: expect.any(Number),
      },
    ]);
    expect(
      mocks.execute.mock.calls.some(([query]) =>
        String((query as { sql?: string }).sql).includes(
          "LOWER(COALESCE(app, '')) IN",
        ),
      ),
    ).toBe(true);
    expect(
      mocks.execute.mock.calls.some(([query]) => {
        const sql = String((query as { sql?: string }).sql);
        const args = (query as { args?: unknown[] }).args ?? [];
        return sql.includes("org_id = ?") && args.includes("org-a");
      }),
    ).toBe(true);
  });

  it("keeps weekly app adoption independent from a one-day lookback", async () => {
    const now = Date.now();
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "orders",
        name: "Orders",
        path: "/orders",
        status: "ready",
        isDispatch: false,
        owner: "owner@example.test",
        visibility: "org",
      },
    ]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email, role, joined_at")) {
        return {
          rows: [
            { email: "owner@example.test", role: "member", joined_at: null },
            { email: "member@example.test", role: "member", joined_at: null },
          ],
        };
      }
      if (
        sql.includes("FROM token_usage") &&
        sql.includes("ORDER BY created_at ASC")
      ) {
        return {
          rows: [
            {
              created_at: now - 2 * 86_400_000,
              owner_email: "owner@example.test",
              app: "orders",
              label: "create-order",
              cost_cents_x100: 100,
            },
            {
              created_at: now - 60 * 60_000,
              owner_email: "member@example.test",
              app: "orders",
              label: "approve-order",
              cost_cents_x100: 200,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const metrics = await listDispatchUsageMetrics({
      sinceDays: 1,
      scope: "app",
      appId: "orders",
    });

    expect(metrics.appAccess[0]).toMatchObject({
      usageCalls: 1,
      dailyActiveUsers: 1,
      weeklyActiveUsers: 2,
    });
    expect(metrics.appAccess[0].actionMetrics).toEqual([
      expect.objectContaining({ key: "approve-order", calls: 1 }),
    ]);
  });

  it("fails closed when app-scope organization membership cannot be read", async () => {
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "orders",
        name: "Orders",
        path: "/orders",
        status: "ready",
        isDispatch: false,
        owner: "owner@example.test",
        visibility: "org",
      },
    ]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT email, role, joined_at")) {
        throw new Error("org member lookup failed");
      }
      return { rows: [] };
    });

    await expect(
      listDispatchUsageMetrics({ scope: "app", appId: "orders" }),
    ).rejects.toThrow("org member lookup failed");
  });

  it("denies app adoption metrics to a non-owner workspace member", async () => {
    mocks.currentOrgId.mockReturnValue("org-a");
    mocks.currentOwnerEmail.mockReturnValue("member@example.test");
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "orders",
        name: "Orders",
        path: "/orders",
        status: "ready",
        isDispatch: false,
        owner: "owner@example.test",
        visibility: "org",
      },
    ]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email, role, joined_at")) {
        return {
          rows: [
            { email: "owner@example.test", role: "member", joined_at: null },
            { email: "member@example.test", role: "member", joined_at: null },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      listDispatchUsageMetrics({
        sinceDays: 30,
        scope: "app",
        appId: "orders",
      }),
    ).rejects.toMatchObject({
      name: "ForbiddenError",
      statusCode: 403,
      message:
        "Only the app owner or an organization owner or admin can view app metrics.",
    });
    expect(mocks.getUsageSummary).not.toHaveBeenCalled();
  });

  it("redacts adoption metrics for apps the personal viewer does not own", async () => {
    const now = Date.now();
    mocks.currentOwnerEmail.mockReturnValue("member@example.test");
    mocks.getUsageSummary.mockResolvedValue(null);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "orders",
        name: "Orders",
        path: "/orders",
        status: "ready",
        isDispatch: false,
        owner: "owner@example.test",
        visibility: "org",
      },
    ]);
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (
        sql.includes("FROM token_usage") &&
        sql.includes("ORDER BY created_at ASC")
      ) {
        return {
          rows: [
            {
              created_at: now,
              owner_email: "member@example.test",
              app: "orders",
              label: "create-order",
              cost_cents_x100: 100,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const metrics = await listDispatchUsageMetrics({ scope: "me" });

    expect(metrics.appAccess[0]).toMatchObject({
      ownerEmail: null,
      isOwnedByViewer: false,
      canViewUsage: false,
      usersWithUsage: 0,
      dailyActiveUsers: 0,
      weeklyActiveUsers: 0,
      usageCalls: 0,
      chatCalls: 0,
      costCents: 0,
      lastActiveAt: null,
      actionMetrics: [],
    });
  });

  it("returns monthly credits and workspace app creation rows from shared tables", async () => {
    const firstUsageAt = Date.UTC(2026, 6, 1, 12);
    const secondUsageAt = Date.UTC(2026, 6, 15, 12);
    const firstCreationAt = Date.UTC(2026, 6, 2, 12);
    const secondCreationAt = Date.UTC(2026, 6, 20, 12);

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
      if (
        sql.includes("FROM token_usage") &&
        sql.includes("ORDER BY created_at ASC")
      ) {
        return {
          rows: [
            {
              created_at: firstUsageAt,
              owner_email: "member@example.test",
              label: "chat",
              input_tokens: 10,
              output_tokens: 20,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              cost_cents_x100: 10000,
            },
            {
              created_at: secondUsageAt,
              owner_email: "member@example.test",
              label: "tool",
              input_tokens: 30,
              output_tokens: 40,
              cache_read_tokens: 5,
              cache_write_tokens: 2,
              cost_cents_x100: 20000,
            },
          ],
        };
      }
      if (sql.includes("FROM dispatch_audit_events")) {
        return {
          rows: [
            {
              created_at: firstCreationAt,
              owner_email: "member@example.test",
              actor: "member@example.test",
              target_id: "app-one",
            },
            {
              created_at: secondCreationAt,
              owner_email: "member@example.test",
              actor: "member@example.test",
              target_id: "app-two",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const metrics = await listDispatchUsageMetrics({
      sinceDays: 365,
      scope: "workspace",
    });

    expect(metrics.monthlyByUser).toEqual([
      {
        month: "2026-07",
        ownerEmail: "member@example.test",
        costCents: 300,
        credits: 75,
        calls: 2,
        chatCalls: 1,
        inputTokens: 40,
        outputTokens: 60,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
      },
    ]);
    expect(metrics.workspaceAppCreationsByUserMonth).toEqual([
      {
        month: "2026-07",
        ownerEmail: "member@example.test",
        count: 2,
        appIds: ["app-one", "app-two"],
      },
    ]);
  });
});
