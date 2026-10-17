import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "./types.js";

const recorded = vi.hoisted(() => [] as AuditEvent[]);

vi.mock("./store.js", () => ({
  insertAuditEvent: async (event: AuditEvent) => {
    recorded.push(event);
  },
}));
vi.mock("../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async () => "owner",
  readPersonalProviderKeyPolicy: async () => ({
    restricted: false,
    updatedAt: null,
    updatedBy: null,
  }),
  writePersonalProviderKeyPolicy: async () => ({
    changed: true,
    policy: { restricted: true, updatedAt: 1, updatedBy: "owner@example.test" },
  }),
}));
vi.mock("../server/personal-provider-key-holders.js", () => ({
  listPersonalProviderKeyHolders: async () => [],
}));
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async () => null,
  mutateSetting: async (_key: string, update: (value: null) => unknown) =>
    update(null),
}));
vi.mock("../server/credential-provider.js", () => ({
  prefetchSecrets: async () => undefined,
  resolveBuilderCredentialsDetailed: async () => ({
    privateKey: null,
    publicKey: null,
    source: null,
    lookupFailed: false,
  }),
}));
vi.mock("../server/secret-key-aliases.js", () => ({
  secretKeyNames: (key: string) => [key],
  resolveSecretWithAliasesDetailed: async () => ({
    value: null,
    lookupFailed: false,
  }),
}));

const { default: manageProviderKeyPolicy } =
  await import("../agent/actions/manage-provider-key-policy.js");
const { default: manageServiceProviders } =
  await import("../agent/actions/manage-service-providers.js");
const { recordOrgAdminAuditEvent } = await import("./org-admin.js");
const { routeAuditAttribution } = await import("./attribution.js");
const { markVerifiedMcpCredentialForEvent } =
  await import("../server/request-context.js");

const OWNER = "owner@example.test";

const mcpCall = {
  userEmail: OWNER,
  orgId: "org-1",
  caller: "mcp" as const,
  mcpClient: {
    name: "Example Client",
    version: "1.0",
    oauthClientId: "example-oauth-client",
  },
  mcpClientAccepted: true as const,
};

function roleChange(event: { context?: Record<string, unknown> }) {
  return recordOrgAdminAuditEvent({
    action: "change-member-role",
    targetType: "org-member-role",
    targetId: "member@example.test",
    summary: "Changed member@example.test from member to admin",
    userEmail: OWNER,
    orgId: "org-1",
    attribution: routeAuditAttribution(event),
  });
}

beforeEach(() => {
  recorded.length = 0;
  delete process.env.AGENT_NATIVE_AUDIT_ENABLED;
});

describe("admin writes recorded outside the action's own audit", () => {
  it("keep the MCP client, OAuth client and approval of a provider key policy change", async () => {
    await manageProviderKeyPolicy.run(
      { set: true },
      { ...mcpCall, actionName: "manage-provider-key-policy" },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "manage-provider-key-policy",
      caller: "mcp",
      actorKind: "agent",
      reportedClientName: "Example Client",
      reportedClientVersion: "1.0",
      oauthClientId: "example-oauth-client",
      approval: "mcp-client-accepted",
    });
  });

  it("keep the MCP client, OAuth client and approval of a service provider choice", async () => {
    await manageServiceProviders.run(
      { service: "voice", provider: "gemini" },
      { ...mcpCall, actionName: "manage-service-providers" },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "manage-service-providers",
      caller: "mcp",
      actorKind: "agent",
      reportedClientName: "Example Client",
      reportedClientVersion: "1.0",
      oauthClientId: "example-oauth-client",
      approval: "mcp-client-accepted",
    });
  });

  it("record a route write from the UI as the person over http", async () => {
    await roleChange({ context: {} });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      caller: "http",
      actorKind: "human",
      actorEmail: OWNER,
      reportedClientName: null,
      reportedClientVersion: null,
      oauthClientId: null,
      approval: null,
    });
  });

  it("record a route write under a verified MCP credential as the agent with its OAuth client", async () => {
    const event = { context: {} };
    markVerifiedMcpCredentialForEvent(event, {
      userEmail: OWNER,
      oauthClientId: "example-oauth-client",
    });

    await roleChange(event);

    expect(recorded[0]).toMatchObject({
      caller: "mcp",
      actorKind: "agent",
      actorEmail: OWNER,
      oauthClientId: "example-oauth-client",
      reportedClientName: null,
      approval: null,
    });
  });
});
