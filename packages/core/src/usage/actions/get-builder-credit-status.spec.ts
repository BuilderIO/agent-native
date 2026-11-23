import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderCreditUsage: vi.fn(),
  getRequestOrgId: vi.fn(),
  clearBuilderCreditLimitNotice: vi.fn(),
  canViewWorkspaceUsage: vi.fn(),
  engine: { name: "builder", usable: true },
  resolveChatEngine: vi.fn(),
  resolveOwnerEngineApiKey: vi.fn(async () => ({ apiKey: undefined })),
  countCredentialState: vi.fn(),
  appId: "slides" as string | undefined,
}));

vi.mock("../../action.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../action.js")>()),
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../../server/request-context.js", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
}));
vi.mock("../../server/fusion-app.js", () => ({
  getBuilderCreditUsage: mocks.getBuilderCreditUsage,
}));
vi.mock("../../tracking/failure-counters.js", () => ({
  countCredentialState: mocks.countCredentialState,
}));
vi.mock("../builder-credit-notice.js", () => ({
  clearBuilderCreditLimitNotice: mocks.clearBuilderCreditLimitNotice,
}));
vi.mock("../metrics-store.js", () => ({
  canViewWorkspaceUsage: mocks.canViewWorkspaceUsage,
}));
vi.mock("../../agent/engine/index.js", () => ({
  registerBuiltinEngines: vi.fn(),
  isResolvedEngineUsableForRequest: vi.fn(async () => mocks.engine.usable),
}));
vi.mock("../../agent/production-agent.js", () => ({
  resolveChatEngine: mocks.resolveChatEngine,
  resolveOwnerEngineApiKey: mocks.resolveOwnerEngineApiKey,
}));
vi.mock("../../server/credential-provider.js", () => ({
  readDeployCredentialEnv: vi.fn(() => undefined),
}));
vi.mock("../../app-config/index.js", () => ({
  getAppConfig: () => ({ app: { id: mocks.appId } }),
}));

import getBuilderCreditStatus from "./get-builder-credit-status.js";

const context = {
  caller: "frontend",
  userEmail: "person@example.com",
  orgId: "org-1",
} as const;

describe("get-builder-credit-status action", () => {
  beforeEach(() => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(false);
    mocks.getBuilderCreditUsage.mockResolvedValue({
      plan: "paid",
      balance: 10,
      quota: { period: "monthly", limit: 100, used: 90, remaining: 10 },
    });
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.engine.name = "builder";
    mocks.engine.usable = true;
    mocks.resolveChatEngine.mockImplementation(async () => ({
      name: mocks.engine.name,
    }));
  });

  afterEach(() => vi.clearAllMocks());

  it("keeps the chat state but leaves out balance and quota where commercial surfaces are hidden", async () => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(true);
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      billing: { commercialSurfaces: "hide" },
    });
    let result: unknown;
    try {
      result = await getBuilderCreditStatus.run({}, context);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result).toMatchObject({ exhausted: false, period: "monthly" });
    expect(result).not.toHaveProperty("balance");
    expect(result).not.toHaveProperty("quota");
  });

  it("returns null when no Builder connection is available", async () => {
    mocks.getBuilderCreditUsage.mockResolvedValue(null);

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toBeNull();
    expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
  });

  it("does not report exhaustion when the wallet is empty but quota remains", async () => {
    mocks.getBuilderCreditUsage.mockResolvedValueOnce({
      plan: "free",
      balance: 0,
      quota: { period: "daily", limit: 10, used: 8, remaining: 2 },
    });
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: { kind: "usable" },
      exhausted: false,
      period: "daily",
    });
    expect(mocks.clearBuilderCreditLimitNotice).toHaveBeenCalledWith(
      "person@example.com",
      "org-1",
    );
  });

  it.each([
    {
      plan: "free",
      balance: 0,
      quota: { period: "daily", limit: 10, used: 10, remaining: 0 },
    },
    {
      plan: "paid",
      balance: 50,
      quota: { period: "monthly", limit: 100, used: 100, remaining: 0 },
    },
  ] as const)("reports an exhausted $quota.period quota", async (usage) => {
    mocks.getBuilderCreditUsage.mockResolvedValueOnce(usage);
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: {
        kind: "exhausted",
        period: usage.quota.period,
        plan: usage.plan,
      },
      exhausted: true,
      period: usage.quota.period,
    });
    expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
  });

  it("does not report a spent Builder quota when chats run on a provider key", async () => {
    mocks.engine.name = "anthropic";
    mocks.getBuilderCreditUsage.mockResolvedValueOnce({
      plan: "free",
      balance: 0,
      quota: { period: "monthly", limit: 60, used: 60, remaining: 0 },
    });

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: { kind: "usable" },
      exhausted: false,
      period: "monthly",
    });
    expect(mocks.resolveChatEngine).toHaveBeenCalledWith({
      engineOption: undefined,
      ownerKey: { apiKey: undefined },
      appId: "slides",
      credentialIdentity: { userEmail: "person@example.com", orgId: "org-1" },
    });
  });

  it("resolves the engine with the app's default and the user's composer choice, as the chat does", async () => {
    // The user's own default is a provider key, but this app (or the user's
    // pick in the composer) runs chats on Builder: its spent quota stops them.
    mocks.resolveChatEngine.mockImplementation(
      async (input: { engineOption?: string; appId?: string }) => ({
        name:
          input.engineOption === "builder" || input.appId === "slides"
            ? "builder"
            : "anthropic",
      }),
    );
    mocks.getBuilderCreditUsage.mockResolvedValue({
      plan: "free",
      balance: 0,
      quota: { period: "daily", limit: 10, used: 10, remaining: 0 },
    });

    for (const input of [
      { orgId: "org-1" },
      { orgId: "org-1", engine: "builder" },
    ]) {
      mocks.appId = input.engine ? undefined : "slides";
      await expect(
        getBuilderCreditStatus.run(input, context),
      ).resolves.toMatchObject({
        state: { kind: "exhausted" },
        exhausted: true,
      });
    }
    expect(mocks.resolveOwnerEngineApiKey).toHaveBeenLastCalledWith({
      engineOption: "builder",
      ownerEmail: "person@example.com",
      anthropicFallback: undefined,
    });
    mocks.appId = "slides";
  });

  it("reports the quota with an unknown state when the chat's engine cannot be resolved", async () => {
    mocks.resolveChatEngine.mockRejectedValue(new Error("settings unreadable"));
    mocks.getBuilderCreditUsage.mockResolvedValue({
      plan: "free",
      balance: 0,
      quota: { period: "daily", limit: 10, used: 10, remaining: 0 },
    });

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: { kind: "unknown", quotaSpent: true },
      exhausted: false,
      period: "daily",
    });
  });

  it("reports why chats cannot run instead of a credit notice", async () => {
    mocks.engine.usable = false;

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toMatchObject({
      state: { kind: "missing", credential: "builder" },
      exhausted: false,
    });
  });

  it("counts every state it shows the user, tagged with where it was shown", async () => {
    mocks.engine.usable = false;
    await getBuilderCreditStatus.run({ orgId: "org-1" }, context);
    expect(mocks.countCredentialState).toHaveBeenCalledWith(
      { kind: "missing", credential: "builder" },
      "credit_notice",
    );
  });

  it("clears the dedupe latch only after a readable balance is available", async () => {
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: { kind: "usable" },
      exhausted: false,
      period: "monthly",
    });
    expect(mocks.clearBuilderCreditLimitNotice).toHaveBeenCalledWith(
      "person@example.com",
      "org-1",
    );
  });

  it("returns the live balance and quota only to workspace admins", async () => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(true);

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: { kind: "usable" },
      exhausted: false,
      period: "monthly",
      balance: 10,
      quota: { period: "monthly", limit: 100, used: 90, remaining: 10 },
    });
    expect(mocks.canViewWorkspaceUsage).toHaveBeenCalledWith({
      ownerEmail: "person@example.com",
      orgId: "org-1",
    });
  });

  it("keeps member status limited to exhaustion and period", async () => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(false);

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      state: { kind: "usable" },
      exhausted: false,
      period: "monthly",
    });
  });

  it("preserves unreadable upstream status as an error", async () => {
    mocks.getBuilderCreditUsage.mockRejectedValue(new Error("upstream failed"));

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).rejects.toThrow("upstream failed");
    expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
  });

  it.each([
    { active: "org-1", requested: "org-2" },
    { active: "org-1", requested: null },
    { active: "org-1", requested: "" },
    { active: null, requested: "org-1" },
  ])(
    "rejects scope $requested when the active scope is $active before credit reads",
    async ({ active, requested }) => {
      mocks.getRequestOrgId.mockReturnValue(active);
      await expect(
        getBuilderCreditStatus.run({ orgId: requested }, context),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "builder_credit_org_mismatch",
      });
      expect(mocks.canViewWorkspaceUsage).not.toHaveBeenCalled();
      expect(mocks.getBuilderCreditUsage).not.toHaveBeenCalled();
      expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
    },
  );

  it.each([null, ""])(
    "accepts an explicit personal scope %s",
    async (orgId) => {
      mocks.getRequestOrgId.mockReturnValue(null);
      await expect(
        getBuilderCreditStatus.run({ orgId }, context),
      ).resolves.toMatchObject({
        state: { kind: "usable" },
      });
      expect(mocks.canViewWorkspaceUsage).toHaveBeenCalledWith({
        ownerEmail: "person@example.com",
        orgId: null,
      });
    },
  );

  it.each([null, "org-1"])(
    "uses the active scope %s when the argument is omitted",
    async (active) => {
      mocks.getRequestOrgId.mockReturnValue(active);
      await expect(
        getBuilderCreditStatus.run({}, context),
      ).resolves.toMatchObject({
        state: { kind: "usable" },
      });
      expect(mocks.canViewWorkspaceUsage).toHaveBeenCalledWith({
        ownerEmail: "person@example.com",
        orgId: active,
      });
    },
  );
});

it("keeps get-builder-credit-status in the app, off MCP", () => {
  expect(getBuilderCreditStatus.mcpTool).toBe(false);
});
