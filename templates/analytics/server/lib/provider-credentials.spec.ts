import { AgentConnectionRequiredError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coreResult: null as unknown,
  localCredentials: new Map<string, string>(),
  coreResolverCalls: [] as Array<Record<string, unknown>>,
  workspaceConnectionResult: null as unknown,
  workspaceConnectionCalls: [] as Array<Record<string, unknown>>,
  oauthResult: null as unknown,
  oauthError: null as Error | null,
  oauthCalls: [] as Array<Record<string, unknown>>,
  ownedOAuthAccounts: [] as Array<Record<string, unknown>>,
  ownedOAuthCalls: [] as Array<Array<unknown>>,
  requestContext: {} as object,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: vi.fn(async (...args) => {
    mocks.ownedOAuthCalls.push(args);
    return mocks.ownedOAuthAccounts;
  }),
}));

vi.mock("@agent-native/core/provider-api", () => ({
  isProviderApiId: vi.fn((provider: string) =>
    ["bigquery", "github", "hubspot", "notion", "slack"].includes(provider),
  ),
  resolveProviderApiOAuthAccessToken: vi.fn(async (...args) => {
    mocks.oauthCalls.push({ args });
    if (mocks.oauthError) throw mocks.oauthError;
    return mocks.oauthResult;
  }),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionCredentialForApp: vi.fn(async (args) => {
    mocks.coreResolverCalls.push(args);
    return (
      mocks.coreResult ?? {
        available: false,
        status: "not_available",
        reason: "No workspace connection",
        provider: args.provider,
        key: args.key,
        provenance: null,
        checked: [],
      }
    );
  }),
  resolveWorkspaceConnectionForApp: vi.fn(async (args) => {
    mocks.workspaceConnectionCalls.push(args);
    return (
      mocks.workspaceConnectionResult ?? {
        available: false,
        connection: null,
        appAccess: null,
        reason: "No workspace connection",
      }
    );
  }),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => mocks.requestContext,
}));

vi.mock("./credentials", () => ({
  resolveCredentialDetailed: vi.fn(async (key: string) => {
    const value = mocks.localCredentials.get(key);
    return value ? { value, scope: "org", scopeId: "org-1" } : undefined;
  }),
}));

import {
  GONG_ANALYTICS_CREDENTIAL_KEYS,
  HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
  resolveAnalyticsGongCredentials,
  resolveAnalyticsProviderCredential,
  resolveBigQueryOAuthCredential,
  resolveWorkspaceConnectionProviderCredential,
} from "./provider-credentials.js";

describe("analytics provider credentials", () => {
  beforeEach(() => {
    mocks.coreResult = null;
    mocks.localCredentials.clear();
    mocks.coreResolverCalls = [];
    mocks.workspaceConnectionResult = null;
    mocks.workspaceConnectionCalls = [];
    mocks.oauthResult = null;
    mocks.oauthError = null;
    mocks.oauthCalls = [];
    mocks.ownedOAuthAccounts = [];
    mocks.ownedOAuthCalls = [];
    mocks.requestContext = {};
  });

  it("resolves Dispatch-granted Sigma credentials through the core resolver", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: { id: "dispatch-sigma", config: {} },
      appAccess: null,
    };
    mocks.coreResult = {
      available: true,
      status: "resolved",
      value: "test-value",
      key: "SIGMA_CLIENT_SECRET",
      provider: "sigma",
      provenance: {
        resolvedKey: "SIGMA_CLIENT_SECRET",
        connectionId: "dispatch-sigma",
        connectionLabel: "Dispatch Sigma",
        secretScope: "org",
      },
    };

    await expect(
      resolveWorkspaceConnectionProviderCredential({
        provider: "sigma",
        keys: ["SIGMA_CLIENT_SECRET"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "dispatch-sigma",
      }),
    ).resolves.toMatchObject({
      value: "test-value",
      source: "workspace_connection",
      connectionId: "dispatch-sigma",
      connectionLabel: "Dispatch Sigma",
    });
    expect(mocks.coreResolverCalls).toContainEqual(
      expect.objectContaining({
        appId: "analytics",
        provider: "sigma",
        key: "SIGMA_CLIENT_SECRET",
        connectionId: "dispatch-sigma",
        userEmail: "owner@example.test",
        orgId: "org-1",
      }),
    );
  });

  it("fails distinctly when an Analytics-direct credential bundle is unavailable", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "analytics-sigma-direct",
        config: { analyticsSetup: "analytics-direct" },
        allowedApps: ["analytics"],
        allowedUsers: [],
        allowedUserGroups: [],
        credentialRefs: [
          {
            key: "ANALYTICS_SIGMA_CREDENTIALS",
            scope: "org",
            provider: "sigma",
          },
        ],
      },
      appAccess: null,
    };

    await expect(
      resolveWorkspaceConnectionProviderCredential({
        provider: "sigma",
        keys: ["SIGMA_CLIENT_SECRET"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "analytics-sigma-direct",
      }),
    ).rejects.toMatchObject({
      errorCode: "sigma_direct_credentials_unavailable",
    });
    expect(mocks.coreResolverCalls).toHaveLength(1);
    expect(mocks.coreResolverCalls[0]).toMatchObject({
      key: "ANALYTICS_SIGMA_CREDENTIALS",
      connectionId: "analytics-sigma-direct",
    });
  });

  it("fails distinctly when an Analytics-direct credential bundle is malformed", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "analytics-sigma-direct",
        config: { analyticsSetup: "analytics-direct" },
        allowedApps: ["analytics"],
        allowedUsers: [],
        allowedUserGroups: [],
        credentialRefs: [
          {
            key: "ANALYTICS_SIGMA_CREDENTIALS",
            scope: "org",
            provider: "sigma",
          },
        ],
      },
      appAccess: null,
    };
    mocks.coreResult = {
      available: true,
      status: "resolved",
      value: "not-json",
      key: "ANALYTICS_SIGMA_CREDENTIALS",
      provider: "sigma",
      provenance: {
        resolvedKey: "ANALYTICS_SIGMA_CREDENTIALS",
        connectionId: "analytics-sigma-direct",
        connectionLabel: "Analytics Sigma",
        secretScope: "org",
        credentialRef: {
          source: "connection",
          key: "ANALYTICS_SIGMA_CREDENTIALS",
          scope: "org",
          provider: "sigma",
        },
      },
    };

    await expect(
      resolveWorkspaceConnectionProviderCredential({
        provider: "sigma",
        keys: ["SIGMA_CLIENT_SECRET"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "analytics-sigma-direct",
      }),
    ).rejects.toMatchObject({
      errorCode: "sigma_direct_credentials_unavailable",
    });
  });

  it("reports an invalid direct-connection access policy with a typed error", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "analytics-sigma-direct",
        config: { analyticsSetup: "analytics-direct" },
        allowedApps: [],
        allowedUsers: [],
        allowedUserGroups: [],
        credentialRefs: [
          {
            key: "ANALYTICS_SIGMA_CREDENTIALS",
            scope: "org",
            provider: "sigma",
          },
        ],
      },
      appAccess: null,
    };

    await expect(
      resolveWorkspaceConnectionProviderCredential({
        provider: "sigma",
        keys: ["SIGMA_CLIENT_SECRET"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "analytics-sigma-direct",
      }),
    ).rejects.toMatchObject({ errorCode: "sigma_connection_policy_invalid" });
    expect(mocks.coreResolverCalls).toHaveLength(0);
  });

  it("returns null for an optional field missing from a valid Analytics bundle", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "analytics-sigma-direct",
        config: { analyticsSetup: "analytics-direct" },
        allowedApps: ["analytics"],
        allowedUsers: [],
        allowedUserGroups: [],
        credentialRefs: [
          {
            key: "ANALYTICS_SIGMA_CREDENTIALS",
            scope: "org",
            provider: "sigma",
          },
        ],
      },
      appAccess: null,
    };
    mocks.coreResult = {
      available: true,
      status: "resolved",
      value: JSON.stringify({
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
      key: "ANALYTICS_SIGMA_CREDENTIALS",
      provider: "sigma",
      provenance: {
        resolvedKey: "ANALYTICS_SIGMA_CREDENTIALS",
        connectionId: "analytics-sigma-direct",
        connectionLabel: "Analytics Sigma",
        secretScope: "org",
        credentialRef: {
          source: "connection",
          key: "ANALYTICS_SIGMA_CREDENTIALS",
          scope: "org",
          provider: "sigma",
        },
      },
    };

    await expect(
      resolveWorkspaceConnectionProviderCredential({
        provider: "sigma",
        keys: ["SIGMA_BASE_URL"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "analytics-sigma-direct",
      }),
    ).resolves.toBeNull();
  });

  it("prefers the core workspace connection helper when it resolves a value", async () => {
    mocks.coreResult = {
      available: true,
      status: "resolved",
      value: "workspace-token",
      key: "SLACK_BOT_TOKEN",
      provider: "slack",
      provenance: {
        resolvedKey: "SLACK_BOT_TOKEN",
        connectionId: "conn-1",
        connectionLabel: "Team Slack",
        secretScope: "org",
      },
    };
    mocks.localCredentials.set("SLACK_BOT_TOKEN", "local-token");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "slack",
        keys: ["SLACK_BOT_TOKEN"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "workspace-token",
      source: "workspace_connection",
      connectionId: "conn-1",
      connectionLabel: "Team Slack",
      scope: "org",
    });
    expect(mocks.coreResolverCalls[0]).toMatchObject({
      appId: "analytics",
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      userEmail: "owner@example.test",
      orgId: "org-1",
    });
  });

  it("falls back to Analytics-local credentials when no workspace credential resolves", async () => {
    mocks.coreResult = {
      available: false,
      status: "not_available",
      reason: "No workspace connection",
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      provenance: null,
      checked: [],
    };
    mocks.localCredentials.set("SLACK_BOT_TOKEN", "local-token");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "slack",
        keys: ["SLACK_BOT_TOKEN"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "local-token",
      source: "analytics_local",
    });
  });

  it("uses the caller-owned Analytics GitHub OAuth account before the local PAT", async () => {
    mocks.ownedOAuthAccounts = [
      {
        accountId: "github-account",
        displayName: "Steve Sewell",
        tokens: { accessToken: "user-oauth-token" },
      },
    ];
    mocks.localCredentials.set("GITHUB_TOKEN", "organization-token");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      key: "GITHUB_TOKEN",
      provider: "github",
      source: "analytics_oauth",
      scope: "user",
      scopeId: "owner@example.test",
    });
    expect(mocks.ownedOAuthCalls).toEqual([["github", "owner@example.test"]]);
  });

  it("does not fall back to a caller-owned GitHub OAuth account for org credentials", async () => {
    mocks.ownedOAuthAccounts = [
      {
        accountId: "github-account",
        tokens: { accessToken: "user-oauth-token" },
      },
    ];

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.ownedOAuthCalls).toEqual([]);
  });

  it("does not accept a user-scoped GitHub connection credential for org resolution", async () => {
    mocks.coreResult = {
      available: true,
      status: "resolved",
      value: "user-scoped-token",
      key: "GITHUB_TOKEN",
      provider: "github",
      provenance: {
        resolvedKey: "GITHUB_TOKEN",
        connectionId: "github-user-connection",
        connectionLabel: "Personal GitHub",
        secretScope: "user",
      },
      checked: [],
    };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.coreResolverCalls[0]).toMatchObject({
      credentialScope: "org",
      orgId: "org-1",
    });
  });

  it("does not use a user-owned GitHub OAuth connection for org credentials", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-user-connection",
        ownerEmail: "owner@example.test",
        orgId: null,
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "user-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.oauthCalls).toEqual([]);
  });

  it.each([
    {
      label: "null organization ids",
      contextOrgId: null,
      connectionOrgId: null,
    },
    { label: "empty organization ids", contextOrgId: "", connectionOrgId: "" },
    {
      label: "a missing context organization id",
      contextOrgId: undefined,
      connectionOrgId: "org-1",
    },
    {
      label: "a missing connection organization id",
      contextOrgId: "org-1",
      connectionOrgId: undefined,
    },
  ])("rejects org OAuth when it has $label", async (scope) => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-org-connection",
        ownerEmail: "owner@example.test",
        orgId: scope.connectionOrgId,
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "org-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: scope.contextOrgId,
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.oauthCalls).toEqual([]);
  });

  it("allows an organization-owned GitHub OAuth connection for org credentials", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-org-connection",
        ownerEmail: "owner@example.test",
        orgId: "org-1",
        label: "Organization GitHub",
        allowedApps: ["analytics"],
        config: {
          credentialMode: "oauth",
          workspaceConnectionScope: "organization",
        },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "org-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toMatchObject({
      value: "org-oauth-token",
      source: "workspace_connection",
      scope: "org",
      scopeId: "org-1",
      connectionId: "github-org-connection",
    });
  });

  it("allows legacy org OAuth with unrestricted app access", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-legacy-org-connection",
        ownerEmail: "owner@example.test",
        orgId: "org-1",
        label: "Organization GitHub",
        allowedApps: [],
        allowedUsers: [],
        allowedUserGroups: [],
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "all-apps" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "org-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toMatchObject({
      value: "org-oauth-token",
      source: "workspace_connection",
      scope: "org",
      scopeId: "org-1",
      connectionId: "github-legacy-org-connection",
    });
  });

  it.each([
    {
      label: "user ACLs",
      allowedApps: [],
      allowedUsers: ["owner@example.test"],
      allowedUserGroups: [],
    },
    {
      label: "user-group ACLs",
      allowedApps: [],
      allowedUsers: [],
      allowedUserGroups: ["analytics-team"],
    },
    {
      label: "app allowlist",
      allowedApps: ["analytics"],
      allowedUsers: [],
      allowedUserGroups: [],
    },
  ])("does not infer legacy organization scope from $label", async (acl) => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-legacy-scoped-connection",
        ownerEmail: "owner@example.test",
        orgId: "org-1",
        ...acl,
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "scoped-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.oauthCalls).toEqual([]);
  });

  it("does not treat an explicitly app-scoped OAuth connection as org scope", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-app-connection",
        ownerEmail: "owner@example.test",
        orgId: "org-1",
        allowedApps: ["analytics"],
        allowedUsers: [],
        allowedUserGroups: [],
        config: {
          credentialMode: "oauth",
          workspaceConnectionScope: "app",
        },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "app-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.oauthCalls).toEqual([]);
  });

  it("does not promote a caller-owned OAuth connection to org scope", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "github-user-connection",
        ownerEmail: "owner@example.test",
        orgId: "org-1",
        label: "Personal GitHub",
        allowedUsers: ["owner@example.test"],
        config: {
          credentialMode: "oauth",
          workspaceConnectionScope: "user",
        },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = { accessToken: "user-oauth-token" };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: {
          userEmail: "owner@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.oauthCalls).toEqual([]);
  });

  it("does not use caller-owned GitHub OAuth for a specific connection", async () => {
    mocks.ownedOAuthAccounts = [
      { accountId: "github-account", tokens: { accessToken: "user-token" } },
    ];

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "specific-connection",
      }),
    ).resolves.toBeNull();
    expect(mocks.ownedOAuthCalls).toEqual([]);
  });

  it("does not use caller-owned GitHub OAuth when workspace lookup is disabled", async () => {
    mocks.ownedOAuthAccounts = [
      { accountId: "github-account", tokens: { accessToken: "user-token" } },
    ];

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "github",
        keys: ["GITHUB_TOKEN"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        workspaceConnection: false,
      }),
    ).resolves.toBeNull();
    expect(mocks.ownedOAuthCalls).toEqual([]);
  });

  it("binds workspace lookup to a requested connection without local fallback", async () => {
    mocks.coreResult = {
      available: false,
      status: "not_available",
      reason: "Connection not granted",
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      provenance: null,
      checked: [],
    };
    mocks.localCredentials.set("SLACK_BOT_TOKEN", "local-token");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "slack",
        keys: ["SLACK_BOT_TOKEN"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        connectionId: "conn-specific",
      }),
    ).resolves.toBeNull();
    expect(mocks.coreResolverCalls[0]).toMatchObject({
      appId: "analytics",
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      connectionId: "conn-specific",
    });
  });

  it("supports the HubSpot catalog key and legacy Analytics key locally", async () => {
    mocks.localCredentials.set("HUBSPOT_ACCESS_TOKEN", "legacy-hubspot-token");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "hubspot",
        keys: HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "legacy-hubspot-token",
      key: "HUBSPOT_ACCESS_TOKEN",
      source: "analytics_local",
    });
  });

  it("prefers a granted HubSpot OAuth bearer token over legacy credentials", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "hubspot-oauth-connection",
        label: "HubSpot: Builder.io",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = {
      accessToken: "hubspot-oauth-token",
      accountId: "portal-1",
      accountLabel: "builder.io",
      connectionId: "hubspot-oauth-connection",
      connectionLabel: "HubSpot: Builder.io",
    };
    mocks.localCredentials.set(
      "HUBSPOT_PRIVATE_APP_TOKEN",
      "legacy-hubspot-token",
    );

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "hubspot",
        keys: HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
        ctx: { userEmail: "member@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "hubspot-oauth-token",
      key: "HUBSPOT_OAUTH_TOKEN",
      source: "workspace_connection",
      connectionId: "hubspot-oauth-connection",
      connectionLabel: "HubSpot: Builder.io",
    });
    expect(mocks.workspaceConnectionCalls).toEqual([
      {
        appId: "analytics",
        provider: "hubspot",
        connectionId: undefined,
        requireConnected: true,
      },
    ]);
    expect(mocks.oauthCalls).toEqual([
      {
        args: [
          {
            provider: "hubspot",
            connectionId: "hubspot-oauth-connection",
          },
          expect.objectContaining({
            appId: "analytics",
            providerIds: ["hubspot"],
          }),
        ],
      },
    ]);
    expect(mocks.coreResolverCalls).toEqual([]);
  });

  it("does not hide failures while resolving a granted HubSpot OAuth token", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "hubspot-oauth-connection",
        label: "HubSpot: Builder.io",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "all-apps" },
      reason: "Available.",
    };
    mocks.oauthError = new Error("HubSpot OAuth token refresh failed");
    mocks.localCredentials.set(
      "HUBSPOT_PRIVATE_APP_TOKEN",
      "legacy-hubspot-token",
    );

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "hubspot",
        keys: HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
        ctx: { userEmail: "member@example.test", orgId: "org-1" },
      }),
    ).rejects.toThrow("HubSpot OAuth token refresh failed");
    expect(mocks.coreResolverCalls).toEqual([]);
  });

  it("resolves OAuth at the provider boundary without requiring a matching fallback key", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "notion-oauth-connection",
        label: "Notion: Product",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = {
      accessToken: "notion-oauth-token",
      connectionId: "notion-oauth-connection",
      connectionLabel: "Notion: Product",
    };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "notion",
        keys: ["NOTION_API_KEY"],
        ctx: { userEmail: "member@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "notion-oauth-token",
      key: "NOTION_OAUTH_TOKEN",
      provider: "notion",
      source: "workspace_connection",
    });
    expect(mocks.coreResolverCalls).toEqual([]);
  });

  it("resolves the current user's BigQuery OAuth connection before local keys", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "bigquery-user-connection",
        label: "Analyst Google",
        ownerEmail: "analyst@example.test",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = {
      accessToken: "bigquery-user-token",
      accountId: "analyst@example.test",
      connectionId: "bigquery-user-connection",
      connectionLabel: "Analyst Google",
    };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "bigquery",
        keys: [],
        ctx: { userEmail: "analyst@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "bigquery-user-token",
      key: "BIGQUERY_OAUTH_TOKEN",
      provider: "bigquery",
      source: "workspace_connection",
      connectionId: "bigquery-user-connection",
    });
    expect(mocks.oauthCalls[0]).toMatchObject({
      args: [
        { provider: "bigquery", connectionId: "bigquery-user-connection" },
        expect.objectContaining({
          appId: "analytics",
          providerIds: ["bigquery"],
        }),
      ],
    });
    expect(mocks.workspaceConnectionCalls[0]).toMatchObject({
      connectionOwnerEmail: "analyst@example.test",
    });
    expect(mocks.coreResolverCalls).toEqual([]);
  });

  it("keeps explicitly selected BigQuery OAuth connections owner-scoped", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "bigquery-selected-connection",
        label: "Analyst Google",
        ownerEmail: "analyst@example.test",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthResult = {
      accessToken: "bigquery-user-token",
      accountId: "analyst@example.test",
      connectionId: "bigquery-selected-connection",
      connectionLabel: "Analyst Google",
    };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "bigquery",
        keys: [],
        connectionId: "bigquery-selected-connection",
        ctx: { userEmail: "analyst@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "bigquery-user-token",
      connectionId: "bigquery-selected-connection",
    });
    expect(mocks.workspaceConnectionCalls[0]).toMatchObject({
      connectionId: "bigquery-selected-connection",
      connectionOwnerEmail: "analyst@example.test",
    });
  });

  it("allows service-account fallback when BigQuery OAuth needs reauthorization", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "bigquery-user-connection",
        label: "Analyst Google",
        ownerEmail: "analyst@example.test",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthError = new AgentConnectionRequiredError(
      "BigQuery needs to be reconnected.",
      { provider: "bigquery", reason: "reauthorize", appId: "analytics" },
    );

    await expect(
      resolveBigQueryOAuthCredential({
        userEmail: "analyst@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBeNull();
  });

  it("preserves transient BigQuery OAuth resolution failures", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "bigquery-user-connection",
        label: "Analyst Google",
        ownerEmail: "analyst@example.test",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };
    mocks.oauthError = new Error("OAuth refresh service unavailable");

    await expect(
      resolveBigQueryOAuthCredential({
        userEmail: "analyst@example.test",
        orgId: "org-1",
      }),
    ).rejects.toThrow("OAuth refresh service unavailable");
  });

  it("does not use a personal BigQuery OAuth connection for org-only credentials", async () => {
    mocks.workspaceConnectionResult = {
      available: true,
      connection: {
        id: "bigquery-user-connection",
        label: "Analyst Google",
        config: { credentialMode: "oauth" },
      },
      appAccess: { available: true, mode: "explicit-grant" },
      reason: "Available.",
    };

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "bigquery",
        keys: [],
        ctx: {
          userEmail: "analyst@example.test",
          orgId: "org-1",
          credentialScope: "org",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.workspaceConnectionCalls).toEqual([]);
    expect(mocks.oauthCalls).toEqual([]);
  });

  it("splits legacy Gong API keys for current access key and secret lookups", async () => {
    mocks.localCredentials.set("GONG_API_KEY", "access-key:access-secret");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "gong",
        keys: ["GONG_ACCESS_KEY"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "access-key",
      key: "GONG_API_KEY",
      source: "analytics_local",
    });

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "gong",
        keys: ["GONG_ACCESS_SECRET"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      value: "access-secret",
      key: "GONG_API_KEY",
      source: "analytics_local",
    });

    await expect(
      resolveAnalyticsGongCredentials({
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      accessKey: "access-key",
      accessSecret: "access-secret",
    });
  });

  it("prefers current Gong access key and secret over the legacy combined key", async () => {
    mocks.localCredentials.set("GONG_API_KEY", "legacy-key:legacy-secret");
    mocks.localCredentials.set("GONG_ACCESS_KEY", "current-key");
    mocks.localCredentials.set("GONG_ACCESS_SECRET", "current-secret");

    await expect(
      resolveAnalyticsGongCredentials({
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toMatchObject({
      accessKey: "current-key",
      accessSecret: "current-secret",
    });
  });

  it("does not treat malformed legacy Gong API keys as current credentials", async () => {
    mocks.localCredentials.set("GONG_API_KEY", "not-a-basic-pair");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "gong",
        keys: GONG_ANALYTICS_CREDENTIAL_KEYS,
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBeNull();
  });

  it("can disable workspace connection lookup for app-specific secondary credentials", async () => {
    mocks.coreResult = {
      available: true,
      status: "resolved",
      value: "workspace-slack-token",
      key: "SLACK_BOT_TOKEN_2",
      provider: "slack",
      provenance: null,
      checked: [],
    };
    mocks.localCredentials.set("SLACK_BOT_TOKEN_2", "secondary-local-token");

    await expect(
      resolveAnalyticsProviderCredential({
        provider: "slack",
        keys: ["SLACK_BOT_TOKEN_2"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        workspaceConnection: false,
      }),
    ).resolves.toMatchObject({
      value: "secondary-local-token",
      source: "analytics_local",
    });
    await expect(
      resolveWorkspaceConnectionProviderCredential({
        provider: "slack",
        keys: ["SLACK_BOT_TOKEN_2"],
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
        workspaceConnection: false,
      }),
    ).resolves.toBeNull();
  });
});
