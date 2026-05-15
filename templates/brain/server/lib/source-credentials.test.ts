import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  secrets: new Map<string, string>(),
  localCredential: undefined as string | undefined,
  registeredCredential: null as string | null,
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
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

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: vi.fn(async () => mocks.registeredCredential),
}));

import { resolveSourceCredential } from "./source-credentials.js";

describe("resolveSourceCredential", () => {
  beforeEach(() => {
    mocks.connections = [];
    mocks.grants = [];
    mocks.secrets.clear();
    mocks.localCredential = undefined;
    mocks.registeredCredential = null;
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("prefers granted workspace connection credentials", async () => {
    mocks.connections = [
      {
        id: "conn-1",
        provider: "slack",
        status: "connected",
        allowedApps: ["other-app"],
        credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      },
    ];
    mocks.grants = [
      {
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
    mocks.registeredCredential = "registered-token";

    await expect(
      resolveSourceCredential({
        provider: "slack",
        key: "SLACK_BOT_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("workspace-connection-token");
  });

  it("falls back through Brain-local, registered, then env credentials", async () => {
    mocks.localCredential = "brain-local-token";
    await expect(
      resolveSourceCredential({
        provider: "github",
        key: "GITHUB_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("brain-local-token");

    mocks.localCredential = undefined;
    mocks.registeredCredential = "registered-token";
    await expect(
      resolveSourceCredential({
        provider: "github",
        key: "GITHUB_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("registered-token");

    mocks.registeredCredential = null;
    process.env.SLACK_BOT_TOKEN = "env-token";
    await expect(
      resolveSourceCredential({
        provider: "slack",
        key: "SLACK_BOT_TOKEN",
        ctx: { userEmail: "owner@example.test", orgId: "org-1" },
      }),
    ).resolves.toBe("env-token");
  });

  it("ignores workspace connections that are disabled or not granted to Brain", async () => {
    mocks.connections = [
      {
        id: "disabled",
        provider: "granola",
        status: "disabled",
        allowedApps: [],
        credentialRefs: [{ key: "GRANOLA_API_KEY", scope: "org" }],
      },
      {
        id: "other-app",
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
});
