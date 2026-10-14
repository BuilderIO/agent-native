import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCredential: vi.fn(),
  getGitHubAccessToken: vi.fn(),
  tryRequestCredentialContext: vi.fn(),
  resolveAnalyticsProviderCredential: vi.fn(),
  workspaceConnections: [] as Array<Record<string, any>>,
  workspaceGrants: [] as Array<Record<string, any>>,
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

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({ app, view, to }: { app: string; view: string; to?: string }) =>
      `/_agent-native/open?app=${app}&view=${view}&to=${encodeURIComponent(to ?? "")}`,
  ),
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
  listWorkspaceConnectionGrants: vi.fn(async () => mocks.workspaceGrants),
  listWorkspaceConnections: vi.fn(async () => mocks.workspaceConnections),
  summarizeWorkspaceConnectionProviderForApp: vi.fn(
    ({
      providerId,
      connections,
    }: {
      providerId: string;
      connections: Array<Record<string, any>>;
    }) => {
      if (providerId !== "bigquery") {
        return { ...mocks.workspaceSummary, provider: providerId };
      }
      const providerConnections = connections.filter(
        (connection) => connection.provider === providerId,
      );
      const connected = providerConnections.some(
        (connection) => connection.status === "connected",
      );
      return {
        ...mocks.workspaceSummary,
        provider: providerId,
        grantState: connected ? "connected" : "not_connected",
        grantAvailability: connected ? "available" : "not_connected",
        connectionCount: providerConnections.length,
        grantedConnectionCount: providerConnections.length,
        activeConnectionCount: providerConnections.length,
        hasWorkspaceConnection: providerConnections.length > 0,
        hasGrantedWorkspaceConnection: providerConnections.length > 0,
        hasActiveWorkspaceConnection: connected,
      };
    },
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
    mocks.workspaceConnections = [];
    mocks.workspaceGrants = [];
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
      hasConnectedExternalDataSources: false,
      connectedExternalDataSourceCount: 0,
      dataSourcesSetupLink:
        "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources",
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
    expect(dataSourceStatus.link?.({ args: {}, result })).toEqual({
      url: result.dataSourcesSetupLink,
      label: "Open Analytics data sources",
      view: "data-sources",
    });
  });

  it("uses the canonical PostgreSQL source id in focused setup links", async () => {
    const result = (await dataSourceStatus.run({ key: "postgres" })) as any;
    const postgresql = result.providers.find(
      (provider: any) => provider.provider === "postgresql",
    );

    expect(postgresql).toMatchObject({
      label: "PostgreSQL",
      configured: false,
      setupLink:
        "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dpostgresql%26returnTo%3Dask",
    });
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
      setupLink:
        "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dhubspot%26returnTo%3Dask",
    });
    expect(result).toMatchObject({
      hasConfiguredDataSources: true,
      configuredDataSourceCount: 2,
      hasConnectedExternalDataSources: true,
      connectedExternalDataSourceCount: 1,
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
      setupLink:
        "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dhubspot%26returnTo%3Dask",
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

  it("does not count another member's BigQuery OAuth grant as configured", async () => {
    mocks.workspaceConnections = [
      {
        id: "bigquery-bob",
        provider: "bigquery",
        ownerEmail: "bob@example.com",
        status: "connected",
        config: { credentialMode: "oauth" },
        credentialRefs: [],
      },
    ];
    mocks.hasCredential.mockImplementation(async () => false);

    const result = (await dataSourceStatus.run({ key: "bigquery" })) as any;
    const bigquery = result.providers.find(
      (provider: any) => provider.provider === "bigquery",
    );
    const workspaceBigQuery = result.workspaceConnections.providers.find(
      (provider: any) => provider.id === "bigquery",
    );

    expect(bigquery).toMatchObject({
      configured: false,
      missingRequiredKeys: [
        "BIGQUERY_PROJECT_ID",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON or BigQuery OAuth connection",
      ],
      workspaceConnection: {
        grantState: "not_connected",
        connectionCount: 0,
      },
    });
    expect(workspaceBigQuery).toMatchObject({
      grantState: "not_connected",
      connectionCount: 0,
    });
  });

  it("counts the current user's BigQuery OAuth grant as configured", async () => {
    mocks.workspaceConnections = [
      {
        id: "bigquery-ada",
        provider: "bigquery",
        ownerEmail: "ada@example.com",
        status: "connected",
        config: { credentialMode: "oauth" },
        credentialRefs: [],
      },
    ];
    mocks.hasCredential.mockImplementation(
      async (key: string) => key === "BIGQUERY_PROJECT_ID",
    );

    const result = (await dataSourceStatus.run({ key: "bigquery" })) as any;
    const bigquery = result.providers.find(
      (provider: any) => provider.provider === "bigquery",
    );

    expect(bigquery).toMatchObject({
      configured: true,
      missingRequiredKeys: [],
      workspaceConnection: {
        grantState: "connected",
        connectionCount: 1,
      },
    });
  });

  it("keeps local BigQuery service-account configuration available", async () => {
    mocks.workspaceConnections = [
      {
        id: "bigquery-bob",
        provider: "bigquery",
        ownerEmail: "bob@example.com",
        status: "connected",
        config: { credentialMode: "oauth" },
        credentialRefs: [],
      },
    ];
    mocks.hasCredential.mockImplementation(
      async (key: string) =>
        key === "BIGQUERY_PROJECT_ID" ||
        key === "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    );

    const result = (await dataSourceStatus.run({ key: "bigquery" })) as any;
    const bigquery = result.providers.find(
      (provider: any) => provider.provider === "bigquery",
    );

    expect(bigquery).toMatchObject({
      configured: true,
      missingRequiredKeys: [],
      workspaceConnection: {
        grantState: "not_connected",
        connectionCount: 0,
      },
    });
  });
});
