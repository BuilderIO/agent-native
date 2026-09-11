import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  availableKeys: new Set<string>(),
  providerId: "jira",
  sourceRows: [] as Array<{ provider: string }>,
  workspace: {
    appId: "brain",
    provider: "jira",
    grantState: "not_connected",
    grantAvailability: "not_connected",
    grantAvailabilityMessage: "No shared Jira connection is available.",
    connectionCount: 0,
    grantedConnectionCount: 0,
    activeConnectionCount: 0,
    ungrantedConnectionCount: 0,
    unhealthyGrantedConnectionCount: 0,
    explicitGrantCount: 0,
    credentialRefCount: 0,
    hasWorkspaceConnection: false,
    hasGrantedWorkspaceConnection: false,
    hasActiveWorkspaceConnection: false,
    lastUsedAt: null,
    statuses: [],
    connections: [],
  },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: <T>(action: T) => action,
}));

vi.mock("@agent-native/core/provider-api", () => ({
  isProviderApiId: (provider: string) =>
    provider === "jira" || provider === "github",
  listProviderApiCatalog: (provider: string) => [
    provider === "github"
      ? {
          id: "github",
          auth: "oauth-bearer:github-or-bearer-key:GITHUB_TOKEN",
          credentialKeys: ["GITHUB_TOKEN"],
          docsUrls: [],
          specUrls: [],
          examples: [],
        }
      : {
          id: "jira",
          auth: "oauth-bearer:jira-or-basic:JIRA_USER_EMAIL:JIRA_API_TOKEN",
          credentialKeys: [
            "JIRA_BASE_URL",
            "JIRA_USER_EMAIL",
            "JIRA_API_TOKEN",
          ],
          docsUrls: [],
          specUrls: [],
          examples: [],
        },
  ],
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  findWorkspaceDispatchAgent: () => undefined,
  getBuiltinAgents: () => [
    {
      id: "dispatch",
      name: "Dispatch",
      description: "Workspace hub",
      url: "https://dispatch.agent-native.com",
      color: "#000000",
    },
  ],
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({}),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionProviderCatalogForApp: async () => ({
    providers: [
      {
        id: mocks.providerId,
        label: mocks.providerId === "github" ? "GitHub" : "Jira Cloud",
        description: "Query the provider on demand.",
        capabilities: ["search"],
        credentialKeys:
          mocks.providerId === "github"
            ? [{ key: "GITHUB_TOKEN", label: "Token", required: false }]
            : [
                { key: "JIRA_BASE_URL", label: "Base URL", required: false },
                {
                  key: "JIRA_USER_EMAIL",
                  label: "User email",
                  required: false,
                },
                { key: "JIRA_API_TOKEN", label: "API token", required: false },
              ],
        workspaceConnection: mocks.workspace,
      },
    ],
    connections: [],
    grants: [],
    counts: {
      providerCount: 1,
      connectionCount: 0,
      grantCount: 0,
    },
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  ne: () => ({}),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => mocks.sourceRows,
      }),
    }),
  }),
  schema: {
    brainSources: {
      provider: "provider",
      status: "status",
    },
    brainSourceShares: {},
  },
}));

vi.mock("../server/lib/source-credentials.js", () => ({
  inspectSourceCredentialAvailability: async ({
    key,
    provider,
  }: {
    key: string;
    provider: string;
  }) => ({
    provider,
    key,
    available: mocks.availableKeys.has(key),
    provenance: null,
    checked: [],
    missingMessage: `${key} is missing.`,
  }),
}));

const { default: action } = await import("./list-connection-providers.js");

describe("list-connection-providers", () => {
  beforeEach(() => {
    mocks.availableKeys.clear();
    mocks.providerId = "jira";
    mocks.sourceRows = [];
    mocks.workspace.provider = "jira";
    mocks.workspace.hasWorkspaceConnection = false;
    mocks.workspace.hasGrantedWorkspaceConnection = false;
    mocks.workspace.hasActiveWorkspaceConnection = false;
    mocks.workspace.grantState = "not_connected";
  });

  it("does not report Jira ready when its optional fallback keys are absent", async () => {
    const result = await action.run({});

    expect(result.providers[0]).toMatchObject({
      id: "jira",
      configured: false,
      setupLink:
        "https://dispatch.agent-native.com/integrations?provider=jira&appId=brain&returnTo=ask",
      sourceProviderSupported: false,
      providerHealth: { status: "missing_credentials" },
      rawProviderApi: { available: true },
    });
  });

  it("reports Jira ready through an active shared connection", async () => {
    mocks.workspace.hasWorkspaceConnection = true;
    mocks.workspace.hasGrantedWorkspaceConnection = true;
    mocks.workspace.hasActiveWorkspaceConnection = true;
    mocks.workspace.grantState = "granted";

    const result = await action.run({});

    expect(result.providers[0]).toMatchObject({
      configured: true,
      providerHealth: { status: "ready" },
    });
  });

  it("reports Jira ready only when the complete Basic-auth fallback exists", async () => {
    mocks.availableKeys.add("JIRA_BASE_URL");
    mocks.availableKeys.add("JIRA_USER_EMAIL");
    mocks.availableKeys.add("JIRA_API_TOKEN");

    const result = await action.run({});

    expect(result.providers[0]).toMatchObject({
      configured: true,
      providerHealth: { status: "ready" },
    });
  });

  it("does not report an existing GitHub source ready without authentication", async () => {
    mocks.providerId = "github";
    mocks.sourceRows = [{ provider: "github" }];
    mocks.workspace.provider = "github";

    const result = await action.run({});

    expect(result.providers[0]).toMatchObject({
      id: "github",
      configured: false,
      hasConfiguredSources: true,
      providerHealth: { status: "missing_credentials" },
    });
  });
});
