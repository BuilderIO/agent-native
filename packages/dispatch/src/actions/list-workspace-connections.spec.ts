import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  CredentialStoreUnavailableError: class MockCredentialStoreUnavailableError extends Error {},
  getWorkspaceConnectionAppAccess: vi.fn(() => ({
    available: true,
    mode: "all-apps",
    grantId: null,
  })),
  hasWorkspaceProviderOAuthCredentials: vi.fn(),
  isProviderApiId: vi.fn(() => false),
  listProviderApiCatalog: vi.fn(() => []),
  listWorkspaceConnectionGrants: vi.fn(),
  listWorkspaceConnectionProviders: vi.fn(),
  listWorkspaceConnectionsForUser: vi.fn(),
  summarizeWorkspaceConnectionProviderReadiness: vi.fn(() => ({
    status: "ready",
    connectionCount: 1,
    activeConnectionCount: 1,
    readyConnectionCount: 1,
    requiredCredentialKeys: [],
    missingRequiredCredentialKeys: [],
  })),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(options: T) => options,
}));

vi.mock("@agent-native/core/connections", () => ({
  listWorkspaceConnectionProviders: mocks.listWorkspaceConnectionProviders,
}));

vi.mock("@agent-native/core/provider-api", () => ({
  isProviderApiId: mocks.isProviderApiId,
  listProviderApiCatalog: mocks.listProviderApiCatalog,
}));

vi.mock("@agent-native/core/server", () => ({
  CredentialStoreUnavailableError: mocks.CredentialStoreUnavailableError,
  hasWorkspaceProviderOAuthCredentials:
    mocks.hasWorkspaceProviderOAuthCredentials,
  isGoogleWorkspaceOAuthProvider: (provider: string) => provider === "gmail",
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  getWorkspaceConnectionAppAccess: mocks.getWorkspaceConnectionAppAccess,
  listWorkspaceConnectionGrants: mocks.listWorkspaceConnectionGrants,
  listWorkspaceConnectionsForUser: mocks.listWorkspaceConnectionsForUser,
  summarizeWorkspaceConnectionProviderReadiness:
    mocks.summarizeWorkspaceConnectionProviderReadiness,
}));

vi.mock("@agent-native/dispatch/actions", () => ({
  dispatchActions: {
    "list-workspace-apps": {
      run: vi.fn(async () => [
        { id: "dispatch", name: "Dispatch", status: "ready" },
      ]),
    },
  },
}));

const action = (await import("./list-workspace-connections.js")).default;

describe("list-workspace-connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasWorkspaceProviderOAuthCredentials.mockRejectedValue(
      new mocks.CredentialStoreUnavailableError(),
    );
    mocks.listWorkspaceConnectionProviders.mockReturnValue([
      { id: "slack", label: "Slack" },
    ]);
    mocks.listWorkspaceConnectionsForUser.mockResolvedValue([
      { id: "visible", provider: "slack", allowedApps: [] },
    ]);
    mocks.listWorkspaceConnectionGrants.mockResolvedValue([
      {
        id: "visible-grant",
        connectionId: "visible",
        provider: "slack",
        appId: "dispatch",
      },
      {
        id: "hidden-grant",
        connectionId: "hidden",
        provider: "slack",
        appId: "dispatch",
      },
    ]);
  });

  it("does not expose grants for connections outside the caller's access", async () => {
    const result = await action.run({ includeDisabled: true });

    expect(mocks.listWorkspaceConnectionsForUser).toHaveBeenCalledWith({
      provider: undefined,
      appId: undefined,
      includeDisabled: true,
    });
    expect(result.connections.map((connection) => connection.id)).toEqual([
      "visible",
    ]);
    expect(result.grants.map((grant) => grant.id)).toEqual([
      "visible:all-apps",
      "visible-grant",
    ]);
  });

  it("filters catalog providers and counts by the requested provider", async () => {
    mocks.listWorkspaceConnectionProviders.mockReturnValue([
      { id: "slack", label: "Slack" },
      { id: "github", label: "GitHub" },
    ]);
    mocks.listWorkspaceConnectionsForUser.mockResolvedValue([
      { id: "visible", provider: "slack", allowedApps: [] },
    ]);
    mocks.listWorkspaceConnectionGrants.mockResolvedValue([]);

    const result = await action.run({ provider: "github" });

    expect(result.providers.map((provider) => provider.id)).toEqual(["github"]);
    expect(result.counts.providers).toBe(1);
  });
});
