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
}));

vi.mock("@agent-native/core/provider-api", () => ({
  isProviderApiId: vi.fn((provider: string) =>
    ["hubspot", "notion", "slack"].includes(provider),
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

vi.mock("./credentials", () => ({
  resolveCredential: vi.fn(async (key: string) =>
    mocks.localCredentials.get(key),
  ),
}));

import {
  GONG_ANALYTICS_CREDENTIAL_KEYS,
  HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
  resolveAnalyticsGongCredentials,
  resolveAnalyticsProviderCredential,
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
