import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigation: {} as Record<string, unknown>,
  appState: {} as Record<string, unknown>,
  listAgentRunFailures: vi.fn(),
  listThreadDebugSources: vi.fn(),
  listWorkspaceResourceOptions: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async (key: string) =>
    key === "navigation" ? mocks.navigation : (mocks.appState[key] ?? null),
  ),
}));

vi.mock("../server/lib/app-creation-store.js", () => ({
  listWorkspaceApps: vi.fn(),
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
  listDispatchUsageMetrics: vi.fn(),
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

describe("view-screen Thread Debug summary", () => {
  beforeEach(() => {
    mocks.navigation = { view: "thread-debug" };
    mocks.appState = {};
    mocks.listAgentRunFailures.mockReset();
    mocks.listAgentRunFailures.mockResolvedValue({ failures: [] });
    mocks.listThreadDebugSources.mockReset();
    mocks.listThreadDebugSources.mockResolvedValue({ sources: [] });
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
    mocks.appState["chat-first-pane"] = {
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
    mocks.appState["chat-first-pane"] = { appId: "mail", view: "inbox" };

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
    mocks.appState["chat-first-pane"] = { placement: "side" };

    const result = JSON.parse(await viewScreen.run({}));

    expect(result.embeddedApp).toMatchObject({
      status: "unknown",
      source: "chat-first-pane",
    });
  });
});
