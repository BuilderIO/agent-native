import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCredential: vi.fn(),
  getGitHubAccessToken: vi.fn(),
  tryRequestCredentialContext: vi.fn(),
  resolveAnalyticsProviderCredential: vi.fn(),
  workspaceSummary: {
    appId: "analytics",
    provider: "hubspot",
    grantState: "not_connected",
    grantAvailability: "not_connected",
    grantAvailabilityMessage: "No shared hubspot workspace connection.",
    connectionCount: 0,
    grantedConnectionCount: 0,
    activeConnectionCount: 0,
    hasWorkspaceConnection: false,
    hasGrantedWorkspaceConnection: false,
    hasActiveWorkspaceConnection: false,
  },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/connections", () => ({
  getWorkspaceConnectionProvider: (provider: string) => ({
    id: provider,
    label: provider === "hubspot" ? "HubSpot" : provider,
    description: null,
    capabilities: [],
    credentialKeys: [],
    recommendedTemplateUses: ["analytics"],
  }),
  listWorkspaceConnectionProvidersForTemplate: () => [
    {
      id: "hubspot",
      label: "HubSpot",
      description: null,
      capabilities: [],
      credentialKeys: [],
      recommendedTemplateUses: ["analytics"],
    },
  ],
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionGrants: vi.fn(async () => []),
  listWorkspaceConnections: vi.fn(async () => []),
  summarizeWorkspaceConnectionProviderForApp: vi.fn(
    ({ providerId }: { providerId: string }) => ({
      ...mocks.workspaceSummary,
      provider: providerId,
    }),
  ),
}));

vi.mock("../server/lib/credentials", () => ({
  hasCredential: mocks.hasCredential,
}));

vi.mock("../server/lib/credentials-context", () => ({
  tryRequestCredentialContext: mocks.tryRequestCredentialContext,
}));

vi.mock("../server/lib/github-oauth", () => ({
  getGitHubAccessToken: mocks.getGitHubAccessToken,
}));

vi.mock("../server/lib/provider-credentials", () => ({
  resolveAnalyticsProviderCredential: mocks.resolveAnalyticsProviderCredential,
}));

const { default: dataSourceStatus } = await import("./data-source-status");

describe("data-source-status", () => {
  beforeEach(() => {
    mocks.hasCredential.mockReset();
    mocks.getGitHubAccessToken.mockReset();
    mocks.tryRequestCredentialContext.mockReset();
    mocks.resolveAnalyticsProviderCredential.mockReset();
    mocks.tryRequestCredentialContext.mockReturnValue({
      userEmail: "ada@example.com",
      orgId: "org-1",
    });
    mocks.getGitHubAccessToken.mockResolvedValue({ token: null });
    mocks.hasCredential.mockResolvedValue(false);
    mocks.workspaceSummary = {
      ...mocks.workspaceSummary,
      grantState: "not_connected",
      grantAvailability: "not_connected",
      connectionCount: 0,
      grantedConnectionCount: 0,
      activeConnectionCount: 0,
      hasWorkspaceConnection: false,
      hasGrantedWorkspaceConnection: false,
      hasActiveWorkspaceConnection: false,
    };
  });

  it("reports the built-in first-party analytics store without external credentials", async () => {
    const result = (await dataSourceStatus.run({})) as any;

    expect(result).toMatchObject({
      hasConfiguredDataSources: true,
      configuredDataSourceCount: 1,
      configuredDataSources: [
        {
          provider: "first-party",
          label: "First-party Analytics",
          via: "built-in",
          queryAction: "query-agent-native-analytics",
        },
      ],
    });
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "first-party",
          configured: true,
          configuredKeys: [],
        }),
      ]),
    );
  });

  it("treats a HubSpot private app token as configured", async () => {
    mocks.hasCredential.mockImplementation(async (key: string) =>
      key === "HUBSPOT_PRIVATE_APP_TOKEN" ? true : false,
    );

    const result = (await dataSourceStatus.run({ key: "hubspot" })) as any;
    const hubspot = result.providers.find(
      (provider: any) => provider.provider === "hubspot",
    );

    expect(hubspot).toMatchObject({
      configured: true,
      configuredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
      missingRequiredKeys: [],
    });
    expect(result).toMatchObject({
      hasConfiguredDataSources: true,
      configuredDataSourceCount: 2,
      configuredDataSources: expect.arrayContaining([
        {
          provider: "first-party",
          label: "First-party Analytics",
          via: "built-in",
          queryAction: "query-agent-native-analytics",
        },
        {
          provider: "hubspot",
          label: "HubSpot",
          via: "credentials",
        },
      ]),
    });
  });

  it("treats a legacy HubSpot access token as configured", async () => {
    mocks.hasCredential.mockImplementation(async (key: string) =>
      key === "HUBSPOT_ACCESS_TOKEN" ? true : false,
    );

    const result = (await dataSourceStatus.run({ key: "hubspot" })) as any;
    const hubspot = result.providers.find(
      (provider: any) => provider.provider === "hubspot",
    );

    expect(hubspot).toMatchObject({
      configured: true,
      configuredKeys: ["HUBSPOT_ACCESS_TOKEN"],
      missingRequiredKeys: [],
    });
  });

  it("keeps any-mode provider status when checking an exact legacy key", async () => {
    mocks.hasCredential.mockImplementation(async (key: string) =>
      key === "HUBSPOT_ACCESS_TOKEN" ? true : false,
    );

    const result = (await dataSourceStatus.run({
      key: "HUBSPOT_ACCESS_TOKEN",
    })) as any;
    const hubspot = result.providers.find(
      (provider: any) => provider.provider === "hubspot",
    );

    expect(hubspot).toMatchObject({
      configured: true,
      configuredKeys: ["HUBSPOT_ACCESS_TOKEN"],
      missingRequiredKeys: [],
    });
  });

  it("treats a connected HubSpot workspace connection as configured", async () => {
    mocks.workspaceSummary = {
      ...mocks.workspaceSummary,
      grantState: "connected",
      grantAvailability: "available",
      connectionCount: 1,
      grantedConnectionCount: 1,
      activeConnectionCount: 1,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: true,
    };

    const result = (await dataSourceStatus.run({ key: "hubspot" })) as any;
    const hubspot = result.providers.find(
      (provider: any) => provider.provider === "hubspot",
    );

    expect(hubspot).toMatchObject({
      configured: true,
      configuredKeys: [],
      workspaceConnection: {
        grantState: "connected",
        connectionCount: 1,
      },
    });
    expect(result.configuredDataSources).toEqual(
      expect.arrayContaining([
        {
          provider: "first-party",
          label: "First-party Analytics",
          via: "built-in",
          queryAction: "query-agent-native-analytics",
        },
        {
          provider: "hubspot",
          label: "HubSpot",
          via: "workspace",
        },
      ]),
    );
  });
});
