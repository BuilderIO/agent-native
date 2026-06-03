import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coreResult: null as unknown,
  localCredentials: new Map<string, string>(),
  coreResolverCalls: [] as Array<Record<string, unknown>>,
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
}));

vi.mock("./credentials", () => ({
  resolveCredential: vi.fn(async (key: string) =>
    mocks.localCredentials.get(key),
  ),
}));

import {
  HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
  resolveAnalyticsProviderCredential,
  resolveWorkspaceConnectionProviderCredential,
} from "./provider-credentials.js";

describe("analytics provider credentials", () => {
  beforeEach(() => {
    mocks.coreResult = null;
    mocks.localCredentials.clear();
    mocks.coreResolverCalls = [];
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
