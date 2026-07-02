import { describe, expect, it } from "vitest";

import type {
  WorkspaceConnectionCredentialsResolution,
  WorkspaceConnectionForApp,
} from "../workspace-connections/index.js";
import {
  PROVIDER_READERS,
  ProviderReaderRuntimeError,
  createProviderReaderRuntime,
  defineProviderReaderImplementation,
  getProviderReader,
  listProviderReaders,
  providerReaderSupports,
} from "./reader.js";

describe("provider reader registry", () => {
  it("registers conservative reader definitions for the initial providers", () => {
    expect(PROVIDER_READERS.map((reader) => reader.providerId)).toEqual([
      "slack",
      "github",
      "notion",
      "hubspot",
      "gmail",
      "google_drive",
      "generic",
    ]);
  });

  it("filters readers by provider, operation, capability, and implementation status", () => {
    expect(
      listProviderReaders({ operation: "listRecent" }).map(
        (reader) => reader.providerId,
      ),
    ).toEqual([
      "slack",
      "github",
      "notion",
      "hubspot",
      "gmail",
      "google_drive",
    ]);

    expect(
      listProviderReaders({ capability: "crm" }).map(
        (reader) => reader.providerId,
      ),
    ).toEqual(["hubspot"]);

    expect(
      listProviderReaders({ implementationStatus: "metadata-only" }).map(
        (reader) => reader.providerId,
      ),
    ).toEqual(["generic"]);

    expect(
      listProviderReaders({
        providerId: "google_drive",
        operation: "get",
      }).map((reader) => reader.providerId),
    ).toEqual(["google_drive"]);
  });

  it("looks up readers and checks operation support", () => {
    expect(getProviderReader("github")).toMatchObject({
      providerId: "github",
      implementationStatus: "template-owned",
      requiredCredentialKeys: ["GITHUB_TOKEN"],
    });
    expect(getProviderReader("missing")).toBeUndefined();

    expect(providerReaderSupports("slack", "search")).toBe(true);
    expect(providerReaderSupports("generic", "listRecent")).toBe(false);

    const genericReader = getProviderReader("generic");
    expect(genericReader).toBeDefined();
    expect(providerReaderSupports(genericReader!, "get")).toBe(true);
  });

  it("makes live implementation status explicit at reader and operation level", () => {
    for (const reader of PROVIDER_READERS) {
      expect(["metadata-only", "template-owned", "shared"]).toContain(
        reader.implementationStatus,
      );
      expect(reader.credentialKeys.map((credential) => credential.key)).toEqual(
        expect.arrayContaining(reader.requiredCredentialKeys),
      );

      for (const operation of reader.operations) {
        expect(["metadata-only", "template-owned", "shared"]).toContain(
          operation.implementationStatus,
        );
      }
    }

    expect(
      listProviderReaders({ implementationStatus: "shared" }),
    ).toHaveLength(0);
  });

  it("calls registered runtime handlers through granted workspace connections", async () => {
    const credentialRequests: string[][] = [];
    const runtime = createProviderReaderRuntime({
      appId: "brain",
      readers: [
        defineProviderReaderImplementation({
          providerId: "slack",
          operations: {
            search: async (params, context) => {
              const credentials = await context.requireCredentials();
              return {
                providerId: context.providerId,
                operation: "search",
                connectionId: context.connection.id,
                items: [
                  {
                    id: "msg-1",
                    type: "slack_message",
                    title: String(params.query),
                    metadata: {
                      credentialKeys: Object.keys(credentials.values),
                      refSources: context.connection.credentialRefs.map(
                        (ref) => ref.source,
                      ),
                    },
                  },
                ],
              };
            },
          },
        }),
      ],
      resolveConnection: async () => ({
        available: true,
        reason: "Available",
        appAccess: {
          appId: "brain",
          available: true,
          mode: "explicit-grant",
          reason: "Granted",
          grantId: "grant-slack",
        },
        connection: workspaceConnectionForApp(),
      }),
      resolveCredentials: async ({ keys, providerId, connectionId }) => {
        credentialRequests.push([...keys]);
        return credentialResolution({
          appId: "brain",
          provider: providerId,
          connectionId: connectionId ?? null,
          values: { SLACK_BOT_TOKEN: "xoxb-secret" },
        });
      },
    });

    const response = await runtime.read({
      providerId: "slack",
      operation: "search",
      params: { query: "roadmap" },
    });

    expect(response).toMatchObject({
      providerId: "slack",
      operation: "search",
      connectionId: "conn-slack",
      items: [
        {
          id: "msg-1",
          title: "roadmap",
          metadata: {
            credentialKeys: ["SLACK_BOT_TOKEN"],
            refSources: ["grant", "connection"],
          },
        },
      ],
    });
    expect(credentialRequests).toEqual([["SLACK_BOT_TOKEN"]]);
    expect(JSON.stringify(response)).not.toContain("xoxb-secret");
  });

  it("keeps unsupported providers and operations explicit", async () => {
    const runtime = createProviderReaderRuntime({
      appId: "brain",
      readers: [],
      resolveConnection: async () => {
        throw new Error("connection resolver should not run");
      },
    });

    await expect(
      runtime.read({ providerId: "github", operation: "search" }),
    ).rejects.toMatchObject({
      code: "unsupported_provider",
      providerId: "github",
      operation: "search",
    });

    const githubRuntime = createProviderReaderRuntime({
      appId: "brain",
      readers: [
        defineProviderReaderImplementation({
          providerId: "github",
          operations: {},
        }),
      ],
    });

    await expect(
      githubRuntime.read({ providerId: "github", operation: "search" }),
    ).rejects.toMatchObject({
      code: "unsupported_operation",
      providerId: "github",
      operation: "search",
    });
  });

  it("throws typed errors for unavailable connections and credentials", async () => {
    const runtime = createProviderReaderRuntime({
      appId: "brain",
      readers: [
        defineProviderReaderImplementation({
          providerId: "notion",
          operations: {
            search: async (_params, context) => {
              await context.requireCredentials();
              return {
                providerId: "notion",
                operation: "search",
                connectionId: context.connection.id,
                items: [],
              };
            },
          },
        }),
      ],
      resolveConnection: async () => ({
        available: false,
        reason: "No Notion connection is granted to brain.",
        appAccess: null,
        connection: null,
      }),
    });

    await expect(
      runtime.read({ providerId: "notion", operation: "search" }),
    ).rejects.toBeInstanceOf(ProviderReaderRuntimeError);
    await expect(
      runtime.read({ providerId: "notion", operation: "search" }),
    ).rejects.toMatchObject({
      code: "connection_not_available",
    });

    const missingCredentialsRuntime = createProviderReaderRuntime({
      appId: "brain",
      readers: [
        defineProviderReaderImplementation({
          providerId: "notion",
          operations: {
            search: async (_params, context) => {
              await context.requireCredentials();
              return {
                providerId: "notion",
                operation: "search",
                connectionId: context.connection.id,
                items: [],
              };
            },
          },
        }),
      ],
      resolveConnection: async () => ({
        available: true,
        reason: "Available",
        appAccess: null,
        connection: workspaceConnectionForApp({
          id: "conn-notion",
          provider: "notion",
          label: "Team Notion",
          credentialRefs: [{ key: "NOTION_API_KEY", scope: "org" }],
        }),
      }),
      resolveCredentials: async ({ keys, providerId, connectionId }) =>
        credentialResolution({
          appId: "brain",
          provider: providerId,
          connectionId: connectionId ?? null,
          keys,
          values: {},
        }),
    });

    await expect(
      missingCredentialsRuntime.read({
        providerId: "notion",
        operation: "search",
      }),
    ).rejects.toMatchObject({
      code: "credentials_unavailable",
      providerId: "notion",
      operation: "search",
    });
  });
});

function workspaceConnectionForApp(
  overrides: Partial<WorkspaceConnectionForApp> = {},
): WorkspaceConnectionForApp {
  return {
    id: "conn-slack",
    provider: "slack",
    label: "Team Slack",
    accountId: "T123",
    accountLabel: "Acme",
    status: "connected",
    scopes: [],
    config: {},
    allowedApps: ["brain"],
    credentialRefs: [
      {
        key: "SLACK_BOT_TOKEN",
        scope: "org",
        value: "xoxb-should-not-leak",
      },
    ],
    ownerEmail: "alice@example.com",
    orgId: "org-1",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastUsedAt: null,
    lastCheckedAt: null,
    lastError: null,
    appAccess: {
      appId: "brain",
      available: true,
      mode: "explicit-grant",
      reason: "Granted",
      grantId: "grant-slack",
    },
    explicitGrant: {
      id: "grant-slack",
      connectionId: "conn-slack",
      provider: "slack",
      appId: "brain",
      scopes: [],
      config: {},
      credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
      grantedByEmail: "alice@example.com",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lastUsedAt: null,
    },
    ...overrides,
  };
}

function credentialResolution({
  appId,
  provider,
  connectionId,
  keys,
  values,
}: {
  appId: string;
  provider: string;
  connectionId: string | null;
  keys?: readonly string[];
  values: Record<string, string>;
}): WorkspaceConnectionCredentialsResolution {
  const requestedKeys = keys ?? Object.keys(values);
  const missingKeys = requestedKeys.filter((key) => !values[key]);
  return {
    available: missingKeys.length === 0,
    appId,
    provider,
    connectionId,
    values,
    missingKeys,
    results: Object.fromEntries(
      requestedKeys.map((key) => [
        key,
        {
          available: Boolean(values[key]),
          status: values[key] ? "resolved" : "missing_secret",
          reason: values[key] ? `${key} resolved.` : `${key} missing.`,
          provider,
          key,
          ...(values[key] ? { value: values[key] } : {}),
          provenance: null,
          checked: [],
        },
      ]),
    ),
  };
}
