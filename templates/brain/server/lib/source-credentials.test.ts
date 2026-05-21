import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  secrets: new Map<string, string>(),
  localCredential: undefined as string | undefined,
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  getWorkspaceConnectionAppAccess: vi.fn(
    (
      connection: { id: string; allowedApps: string[] },
      appId: string,
      grants: Array<{ id: string; connectionId: string; appId: string }> = [],
    ) => {
      if (connection.allowedApps.length === 0) {
        return {
          appId,
          available: true,
          mode: "all-apps",
          reason: "Connection is available to every app in the workspace.",
          grantId: null,
        };
      }
      if (connection.allowedApps.includes(appId)) {
        return {
          appId,
          available: true,
          mode: "allowed-app",
          reason: `Connection is directly allowed for ${appId}.`,
          grantId: null,
        };
      }
      const grant = grants.find(
        (entry) =>
          entry.connectionId === connection.id && entry.appId === appId,
      );
      return grant
        ? {
            appId,
            available: true,
            mode: "explicit-grant",
            reason: `Connection has an explicit grant for ${appId}.`,
            grantId: grant.id,
          }
        : {
            appId,
            available: false,
            mode: "unavailable",
            reason: `Grant ${appId} access before this connection can be reused by the app.`,
            grantId: null,
          };
    },
  ),
  listWorkspaceConnections: vi.fn(async () => mocks.connections),
  listWorkspaceConnectionGrants: vi.fn(async () => mocks.grants),
}));

vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: vi.fn(async (ref: Record<string, string>) => {
    const value = mocks.secrets.get(`${ref.scope}:${ref.scopeId}:${ref.key}`);
    return value ? { value, last4: value.slice(-4), updatedAt: 1 } : null;
  }),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: vi.fn(async () => mocks.localCredential),
}));

import {
  inspectSourceCredentialAvailability,
  resolveSourceCredential,
} from "./source-credentials.js";

describe("resolveSourceCredential", () => {
  beforeEach(() => {
    mocks.connections = [];
    mocks.grants = [];
    mocks.secrets.clear();
    mocks.localCredential = undefined;
  });

  it("prefers granted workspace connection credentials without exposing values in availability", async () => {
    mocks.connections = [
      {
        id: "conn-1",
        label: "Team Slack",
        provider: "slack",
        status: "connected",
        allowedApps: ["other-app"],
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
    ];
    mocks.grants = [
      {
        id: "grant-1",
        connectionId: "conn-1",
        appId: "brain",
        provider: "slack",
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
    ];
    mocks.secrets.set(
      "org:org-1:SLACK_BOT_TOKEN",
      "workspace-connection-token",
    );
    mocks.localCredential = "brain-local-token";

    await expect(
      resolveSourceCredential({
        provider: "slack",
        key: "SLACK_BOT_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("workspace-connection-token");

    const availability = await inspectSourceCredentialAvailability({
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      ctx: { userEmail: "owner@example.test", orgId: "org-1" },
    });
    expect(availability).toMatchObject({
      available: true,
      provenance: {
        source: "workspace_connection",
        key: "SLACK_BOT_TOKEN",
        provider: "slack",
        connectionId: "conn-1",
        connectionLabel: "Team Slack",
        grantId: "grant-1",
        appAccessMode: "explicit-grant",
        scope: "org",
      },
      missingMessage: null,
    });
    expect(JSON.stringify(availability)).not.toContain(
      "workspace-connection-token",
    );
  });

  it("falls back through Brain-local credentials and registered vault secrets", async () => {
    mocks.localCredential = "brain-local-token";
    await expect(
      resolveSourceCredential({
        provider: "github",
        key: "GITHUB_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("brain-local-token");

    mocks.localCredential = undefined;
    mocks.secrets.set("org:org-1:GITHUB_TOKEN", "registered-token");
    await expect(
      resolveSourceCredential({
        provider: "github",
        key: "GITHUB_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("registered-token");
  });

  it("does not fall back to deploy env credentials for source credentials", async () => {
    process.env.SLACK_BOT_TOKEN = "env-token";
    await expect(
      resolveSourceCredential({
        provider: "slack",
        key: "SLACK_BOT_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBeUndefined();
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("ignores workspace connections that are disabled or not granted to Brain", async () => {
    mocks.connections = [
      {
        id: "disabled",
        label: "Disabled Granola",
        provider: "granola",
        status: "disabled",
        allowedApps: [],
        credentialRefs: [{ key: "GRANOLA_API_KEY", scope: "org" }],
      },
      {
        id: "other-app",
        label: "Calendar Granola",
        provider: "granola",
        status: "connected",
        allowedApps: ["calendar"],
        credentialRefs: [{ key: "GRANOLA_API_KEY", scope: "org" }],
      },
    ];
    mocks.secrets.set("org:org-1:GRANOLA_API_KEY", "should-not-use");
    mocks.localCredential = "brain-local-granola";

    await expect(
      resolveSourceCredential({
        provider: "granola",
        key: "GRANOLA_API_KEY",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("brain-local-granola");
  });

  it("reports missing grant guidance without returning secret values", async () => {
    mocks.connections = [
      {
        id: "conn-calendar",
        label: "Calendar GitHub",
        provider: "github",
        status: "connected",
        allowedApps: ["calendar"],
        credentialRefs: [{ key: "GITHUB_TOKEN", scope: "org" }],
      },
    ];

    const availability = await inspectSourceCredentialAvailability({
      provider: "github",
      key: "GITHUB_TOKEN",
      ctx: { userEmail: "owner@example.test", orgId: "org-1" },
    });

    expect(availability.available).toBe(false);
    expect(availability.missingMessage).toMatch(/grant Brain access/i);
    expect(availability.checked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "workspace_connection",
          status: "not_granted",
          connectionId: "conn-calendar",
          appAccessMode: "unavailable",
        }),
      ]),
    );
    expect(availability).not.toHaveProperty("value");
  });

  it("uses the bound workspace connection when workspaceConnectionId is present", async () => {
    mocks.connections = [
      {
        id: "conn-a",
        label: "Old Slack",
        provider: "slack",
        status: "connected",
        allowedApps: [],
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
      {
        id: "conn-b",
        label: "Product Slack",
        provider: "slack",
        status: "connected",
        allowedApps: [],
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
    ];
    mocks.secrets.set("org:org-1:SLACK_BOT_TOKEN", "shared-secret");

    const availability = await inspectSourceCredentialAvailability({
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      workspaceConnectionId: "conn-b",
      ctx: { userEmail: "owner@example.test", orgId: "org-1" },
    });

    expect(availability.available).toBe(true);
    expect(availability.provenance).toMatchObject({
      source: "workspace_connection",
      connectionId: "conn-b",
      connectionLabel: "Product Slack",
    });
    expect(availability.checked).toEqual([
      expect.objectContaining({
        source: "workspace_connection",
        status: "available",
        connectionId: "conn-b",
      }),
    ]);
  });

  it("does not fall back when the bound workspace connection is not granted", async () => {
    mocks.connections = [
      {
        id: "bound-calendar",
        label: "Calendar Slack",
        provider: "slack",
        status: "connected",
        allowedApps: ["calendar"],
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
      {
        id: "granted-brain",
        label: "Brain Slack",
        provider: "slack",
        status: "connected",
        allowedApps: [],
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
    ];
    mocks.secrets.set("org:org-1:SLACK_BOT_TOKEN", "workspace-token");
    mocks.localCredential = "brain-local-token";

    await expect(
      resolveSourceCredential({
        provider: "slack",
        key: "SLACK_BOT_TOKEN",
        workspaceConnectionId: "bound-calendar",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBeUndefined();

    const availability = await inspectSourceCredentialAvailability({
      provider: "slack",
      key: "SLACK_BOT_TOKEN",
      workspaceConnectionId: "bound-calendar",
      ctx: { userEmail: "owner@example.test", orgId: "org-1" },
    });

    expect(availability.available).toBe(false);
    expect(availability.missingMessage).toMatch(/not granted to Brain/i);
    expect(availability.checked).toEqual([
      expect.objectContaining({
        source: "workspace_connection",
        status: "not_granted",
        connectionId: "bound-calendar",
      }),
    ]);
  });
});
