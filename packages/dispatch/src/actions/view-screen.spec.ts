import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigation: {} as Record<string, unknown>,
  pane: null as Record<string, unknown> | null,
  tab: { tabId: "parent-one", unavailable: false } as {
    tabId: string | null;
    unavailable: boolean;
  },
  appState: {} as Record<string, unknown>,
  listAgentRunFailures: vi.fn(),
  listThreadDebugSources: vi.fn(),
  listDispatchUsageMetrics: vi.fn(),
  listWorkspaceResourceOptions: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateKeyForBrowserTab: (key: string, tabId: string) => `${key}:${tabId}`,
  resolveCurrentRequestStateTab: async () => mocks.tab,
  readAppState: vi.fn(async (key: string) =>
    key === "navigation" ? mocks.navigation : (mocks.appState[key] ?? null),
  ),
}));

vi.mock("../server/lib/app-creation-store.js", () => ({
  listWorkspaceApps: vi.fn(),
}));

vi.mock("../server/lib/dispatch-pane-context.js", () => ({
  readDispatchPaneContext: async () => mocks.pane,
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  listOverview: vi.fn(async () => ({
    counts: {},
    settings: {},
  })),
}));

vi.mock("../server/lib/thread-debug-store.js", () => ({
  getAgentThreadDebug: vi.fn(),
  listAgentRunFailures: mocks.listAgentRunFailures,
  listThreadDebugSources: mocks.listThreadDebugSources,
  searchAgentThreads: vi.fn(),
}));

vi.mock("../server/lib/usage-metrics-store.js", () => ({
  listDispatchUsageMetrics: (...args: any[]) =>
    mocks.listDispatchUsageMetrics(...args),
}));

vi.mock("../server/lib/vault-store.js", () => ({
  getVaultAccessSettings: vi.fn(),
  canManageVault: vi.fn(async () => false),
  listGrants: vi.fn(),
  listRequests: vi.fn(),
  listSecrets: vi.fn(),
  listVaultOverview: vi.fn(async () => ({})),
}));

vi.mock("../server/lib/workspace-resources-store.js", () => ({
  listWorkspaceResourceOptions: mocks.listWorkspaceResourceOptions,
  listWorkspaceResourcesForApp: vi.fn(),
}));

import viewScreen from "./view-screen.js";

describe("view-screen MCP exposure", () => {
  it("returns current pane identity and paths over MCP without operational data", async () => {
    mocks.navigation = { view: "overview", path: "/account-wide" };
    mocks.appState = {
      "navigation:parent-one": {
        view: "chat",
        path: "/chat/current?filter=private",
        owner: "hidden",
      },
      "navigation:parent-two": { view: "apps", path: "/apps?filter=private" },
    };
    mocks.pane = {
      appId: "workspace/mail",
      path: "/mail/threads/2?filter=private",
    };
    expect(viewScreen.mcpTool).toBe(true);
    expect(viewScreen.readOnly).toBe(true);
    expect(await viewScreen.run({}, { caller: "mcp" } as never)).toEqual({
      navigation: { view: "chat", path: "/chat/current" },
      embeddedApp: {
        status: "open",
        id: "workspace/mail",
        path: "/mail/threads/2",
        source: "chat-first-pane",
      },
    });
    mocks.tab = { tabId: "parent-two", unavailable: false };
    expect(await viewScreen.run({}, { caller: "mcp" } as never)).toEqual({
      navigation: { view: "apps", path: "/apps" },
    });
    for (const tab of [
      { tabId: "parent-without-route", unavailable: false },
      { tabId: null, unavailable: true },
      { tabId: null, unavailable: false },
    ]) {
      mocks.tab = tab;
      expect(await viewScreen.run({}, { caller: "mcp" } as never)).toEqual({});
    }
    mocks.tab = { tabId: "parent-one", unavailable: false };
    mocks.appState = {};
    mocks.pane = null;
  });
});

describe("view-screen app pane", () => {
  it("does not borrow the account-wide pane when the current tab has none", async () => {
    mocks.navigation = { view: "chat" };
    mocks.tab = { tabId: "parent-one", unavailable: false };
    mocks.pane = null;
    mocks.appState = {
      "chat-first-pane": { appId: "workspace/other", path: "/other" },
    };
    try {
      const empty = JSON.parse((await viewScreen.run({})) as string);
      expect(empty).not.toHaveProperty("embeddedApp");

      mocks.pane = { appId: "workspace/current", path: "/current" };
      const current = JSON.parse((await viewScreen.run({})) as string);
      expect(current.embeddedApp).toMatchObject({ id: "workspace/current" });
    } finally {
      mocks.appState = {};
      mocks.pane = null;
    }
  });
});

describe("view-screen Thread Debug summary", () => {
  beforeEach(() => {
    mocks.navigation = { view: "thread-debug" };
    mocks.appState = {};
    mocks.listAgentRunFailures.mockReset();
    mocks.listAgentRunFailures.mockResolvedValue({ failures: [] });
    mocks.listThreadDebugSources.mockReset();
    mocks.listThreadDebugSources.mockResolvedValue({ sources: [] });
    mocks.listDispatchUsageMetrics.mockReset();
    mocks.listWorkspaceResourceOptions.mockReset();
    mocks.listWorkspaceResourceOptions.mockResolvedValue([]);
  });

  it("matches the UI's default 24-hour failed-run range", async () => {
    await viewScreen.run({});

    expect(mocks.listAgentRunFailures).toHaveBeenCalledWith({
      sourceId: "all",
      ownerEmail: undefined,
      status: "all",
      lookbackHours: 24,
      limit: 10,
    });
  });

  it("normalizes invalid status and range query state", async () => {
    mocks.navigation = {
      view: "thread-debug",
      failureStatus: "timed-out",
      range: "forever",
    };

    await viewScreen.run({});

    expect(mocks.listAgentRunFailures).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "all",
        lookbackHours: 24,
      }),
    );
  });

  it("surfaces the focused simple agent on the chat screen", async () => {
    mocks.navigation = {
      view: "chat",
      agentPath: "agents/research-partner.md",
    };
    mocks.listWorkspaceResourceOptions.mockResolvedValue([
      {
        id: "agent-1",
        kind: "agent",
        name: "Research Partner",
        description: "Synthesizes research",
        path: "agents/research-partner.md",
        scope: "all",
        updatedAt: 1,
      },
    ]);

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.chatSurface).toMatchObject({
      agentPath: "agents/research-partner.md",
      agent: { id: "agent-1", name: "Research Partner" },
    });
  });
});

describe("view-screen embedded workspace app", () => {
  beforeEach(() => {
    mocks.navigation = { view: "chat" };
    mocks.appState = {};
    mocks.pane = null;
    mocks.listWorkspaceResourceOptions.mockReset();
    mocks.listWorkspaceResourceOptions.mockResolvedValue([]);
  });

  it("names the app opened through an /apps/<id> route", async () => {
    mocks.navigation = {
      view: "workspace-app",
      path: "/apps/mail/inbox",
      workspaceAppId: "mail",
      workspaceAppPath: "/inbox",
    };

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toEqual({
      status: "open",
      id: "mail",
      path: "/inbox",
      source: "route",
    });
  });

  it("names the chat-first pane app while the route stays on /chat", async () => {
    mocks.pane = {
      appId: "mail",
      path: "/inbox",
      placement: "side",
    };

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toEqual({
      status: "open",
      id: "mail",
      path: "/inbox",
      source: "chat-first-pane",
    });
  });

  it("keeps a pane's named screen when it carries no path", async () => {
    mocks.pane = { appId: "mail", view: "inbox" };

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toEqual({
      status: "open",
      id: "mail",
      path: "/",
      view: "inbox",
      source: "chat-first-pane",
    });
  });

  it("omits the block when no app is open", async () => {
    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toBeUndefined();
    expect(result.chatSurface).toBeDefined();
  });

  it("reports an unreadable route app as unknown instead of the apps list", async () => {
    mocks.navigation = { view: "workspace-app", path: "/apps/%E0%A4%A" };

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toMatchObject({
      status: "unknown",
      source: "route",
    });
    expect(result.embeddedApp.reason).toContain("/apps/%E0%A4%A");
  });

  it("reports a pane that names no app as unknown, not as no app open", async () => {
    mocks.pane = { placement: "side" };

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toMatchObject({
      status: "unknown",
      source: "chat-first-pane",
    });
  });
});

describe("view-screen metrics summary", () => {
  beforeEach(() => {
    mocks.navigation = {
      view: "metrics",
      usageScope: "app",
      usageAppId: "orders",
    };
    mocks.appState = {};
    mocks.listDispatchUsageMetrics.mockReset();
    mocks.listDispatchUsageMetrics.mockResolvedValue({
      billing: { unit: "usd" },
      viewScope: "app",
      selectedUserEmail: null,
      selectedAppId: "orders",
      totals: { calls: 2 },
      byApp: [],
      byUser: [],
      appAccess: [
        {
          id: "orders",
          isDispatch: false,
          usageCalls: 2,
        },
      ],
    });
    mocks.listWorkspaceResourceOptions.mockReset();
    mocks.listWorkspaceResourceOptions.mockResolvedValue([]);
  });

  it("passes the selected app through and returns it in the screen summary", async () => {
    const result = JSON.parse(await viewScreen.run({}));

    expect(mocks.listDispatchUsageMetrics).toHaveBeenCalledWith({
      sinceDays: 30,
      scope: "app",
      userEmail: undefined,
      appId: "orders",
    });
    expect(result.usageMetrics).toMatchObject({
      viewScope: "app",
      selectedAppId: "orders",
      byUser: [],
    });
  });
});
