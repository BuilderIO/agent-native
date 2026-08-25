import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockCredentialStoreUnavailableError extends Error {
    constructor() {
      super("Credential store unavailable");
      this.name = "CredentialStoreUnavailableError";
    }
  }

  return {
    CredentialStoreUnavailableError: MockCredentialStoreUnavailableError,
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
    listWorkspaceConnections: vi.fn(),
    summarizeWorkspaceConnectionProviderReadiness: vi.fn(() => ({
      status: "ready",
      connectionCount: 1,
      activeConnectionCount: 1,
      readyConnectionCount: 1,
      requiredCredentialKeys: [],
      missingRequiredCredentialKeys: [],
    })),
  };
});

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
  listWorkspaceConnections: mocks.listWorkspaceConnections,
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

const action = (await import("../../actions/list-workspace-connections.js"))
  .default;

describe("list-workspace-connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasWorkspaceProviderOAuthCredentials.mockRejectedValue(
      new mocks.CredentialStoreUnavailableError(),
    );
    mocks.listWorkspaceConnectionProviders.mockReturnValue([
      { id: "gmail", label: "Gmail" },
      { id: "slack", label: "Slack" },
    ]);
    mocks.listWorkspaceConnections.mockResolvedValue([
      { id: "google-1", provider: "gmail", allowedApps: [] },
      { id: "slack-1", provider: "slack", allowedApps: [] },
    ]);
    mocks.listWorkspaceConnectionGrants.mockResolvedValue([
      {
        id: "google-grant",
        connectionId: "google-1",
        provider: "gmail",
        appId: "dispatch",
      },
      {
        id: "slack-grant",
        connectionId: "slack-1",
        provider: "slack",
        appId: "dispatch",
      },
    ]);
  });

  it("returns non-Google integrations when the credential store is unavailable", async () => {
    const result = await action.run({ includeDisabled: true });

    expect(result.availability.googleOAuth).toEqual({
      status: "unavailable",
      retryable: true,
    });
    expect(result.providers.map((provider) => provider.id)).toEqual(["slack"]);
    expect(result.connections.map((connection) => connection.id)).toEqual([
      "slack-1",
    ]);
    expect(result.grants.map((grant) => grant.id)).toEqual([
      "slack-1:all-apps",
      "slack-grant",
    ]);
  });
});
