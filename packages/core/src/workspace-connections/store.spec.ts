import Database from "better-sqlite3";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => sharedClient,
    isPostgres: () => false,
    intType: () => "INTEGER",
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args?: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sqlite: Database.Database;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};
let previousSecretsEncryptionKey: string | undefined;

beforeAll(() => {
  previousSecretsEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = "workspace-connections-test-key";
  sqlite = new Database(":memory:");
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = sqlite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = stmt.all(...args) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

beforeEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  try {
    sqlite.prepare("DELETE FROM workspace_connection_grants").run();
  } catch {
    // The first test creates the table through the store initializer.
  }
  try {
    sqlite.prepare("DELETE FROM workspace_connections").run();
  } catch {
    // The first test creates the table through the store initializer.
  }
  try {
    sqlite.prepare("DELETE FROM app_secrets").run();
  } catch {
    // The first secret-backed test creates the table through the store.
  }
  try {
    sqlite.prepare("DELETE FROM settings").run();
  } catch {
    // Credential fallback tests create the settings table on demand.
  }
});

afterAll(() => {
  if (previousSecretsEncryptionKey === undefined) {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  } else {
    process.env.SECRETS_ENCRYPTION_KEY = previousSecretsEncryptionKey;
  }
  sqlite.close();
});

describe("workspace connection store", () => {
  it("describes app-level access semantics", async () => {
    const { getWorkspaceConnectionAppAccess } = await import("./store.js");
    const baseConnection = {
      id: "conn-1",
      label: "Team Slack",
      allowedApps: ["dispatch"],
    };

    expect(
      getWorkspaceConnectionAppAccess(
        { ...baseConnection, allowedApps: [] },
        "brain",
      ),
    ).toMatchObject({
      available: true,
      mode: "all-apps",
      grantId: null,
    });

    expect(
      getWorkspaceConnectionAppAccess(
        { ...baseConnection, allowedApps: ["brain"] },
        "brain",
      ),
    ).toMatchObject({
      available: true,
      mode: "allowed-app",
      grantId: null,
    });

    expect(
      getWorkspaceConnectionAppAccess(baseConnection, "brain", [
        { id: "grant-1", connectionId: "conn-1", appId: "brain" },
      ]),
    ).toMatchObject({
      available: true,
      mode: "explicit-grant",
      grantId: "grant-1",
    });

    expect(
      getWorkspaceConnectionAppAccess(baseConnection, "brain"),
    ).toMatchObject({
      available: false,
      mode: "unavailable",
      grantId: null,
    });
  });

  it("summarizes provider access for an app without exposing secret values", async () => {
    const { summarizeWorkspaceConnectionProviderForApp } =
      await import("./store.js");
    const summary = summarizeWorkspaceConnectionProviderForApp({
      providerId: "slack",
      appId: "brain",
      includeConnections: "all",
      connections: [
        {
          id: "conn-open",
          provider: "slack",
          label: "Open Slack",
          accountId: null,
          accountLabel: "Acme",
          status: "connected",
          scopes: [],
          config: {},
          allowedApps: [],
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
          lastCheckedAt: null,
          lastError: null,
        },
        {
          id: "conn-dispatch",
          provider: "slack",
          label: "Dispatch Slack",
          accountId: null,
          accountLabel: null,
          status: "needs_reauth",
          scopes: [],
          config: {},
          allowedApps: ["dispatch"],
          credentialRefs: [],
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: "Expired token",
        },
      ],
      grants: [],
    });

    expect(summary).toMatchObject({
      appId: "brain",
      provider: "slack",
      grantState: "connected",
      grantAvailability: "available",
      connectionCount: 2,
      grantedConnectionCount: 1,
      activeConnectionCount: 1,
      ungrantedConnectionCount: 1,
      unhealthyGrantedConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: true,
    });
    expect(summary.connections).toHaveLength(2);
    expect(summary.connections[0].credentialRefs[0]).toEqual({
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: undefined,
      label: undefined,
      source: "connection",
    });
    expect(JSON.stringify(summary)).not.toContain("xoxb-should-not-leak");
  });

  it("summarizes provider readiness with required credential refs and app grants", async () => {
    const { summarizeWorkspaceConnectionProviderReadiness } =
      await import("./store.js");
    const readinessInput = {
      provider: {
        id: "github",
        credentialKeys: [
          { key: "GITHUB_TOKEN", required: true },
          { key: "GITHUB_WEBHOOK_SECRET", required: false },
        ],
      },
      appId: "analytics",
      connections: [
        {
          id: "conn-github",
          provider: "github",
          label: "GitHub",
          accountId: null,
          accountLabel: null,
          status: "connected",
          scopes: [],
          config: {},
          allowedApps: ["brain"],
          credentialRefs: [],
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: null,
        },
      ],
      grants: [
        {
          id: "grant-analytics",
          connectionId: "conn-github",
          provider: "github",
          appId: "analytics",
          scopes: [],
          config: {},
          credentialRefs: [],
          grantedByEmail: "alice@example.com",
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    } satisfies Parameters<
      typeof summarizeWorkspaceConnectionProviderReadiness
    >[0];
    const readiness =
      summarizeWorkspaceConnectionProviderReadiness(readinessInput);

    expect(readiness).toMatchObject({
      status: "needs_credentials",
      connectionCount: 1,
      activeConnectionCount: 1,
      readyConnectionCount: 0,
      requiredCredentialKeys: ["GITHUB_TOKEN"],
      missingRequiredCredentialKeys: ["GITHUB_TOKEN"],
      appGrant: {
        grantState: "connected",
        grantAvailability: "available",
        grantedConnectionCount: 1,
        explicitGrantCount: 1,
      },
    });

    const grantScopedRefReadiness =
      summarizeWorkspaceConnectionProviderReadiness({
        ...readinessInput,
        grants: [
          {
            ...readinessInput.grants[0],
            credentialRefs: [{ key: "GITHUB_TOKEN", scope: "org" }],
          },
        ],
      });

    expect(grantScopedRefReadiness).toMatchObject({
      status: "ready",
      readyConnectionCount: 1,
      missingRequiredCredentialKeys: [],
    });
  });

  it("scopes personal list, upsert, and delete to the request user", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      deleteWorkspaceConnection,
      listWorkspaceConnections,
      upsertWorkspaceConnection,
    } = await import("./store.js");

    await runWithRequestContext({ userEmail: "alice@example.com" }, () =>
      upsertWorkspaceConnection({
        id: "conn-personal",
        provider: "google",
        label: "Alice Google",
      }),
    );

    const aliceList = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () => listWorkspaceConnections(),
    );
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]).toMatchObject({
      id: "conn-personal",
      ownerEmail: "alice@example.com",
      orgId: null,
    });

    await expect(
      runWithRequestContext({ userEmail: "bob@example.com" }, () =>
        upsertWorkspaceConnection({
          id: "conn-personal",
          provider: "google",
          label: "Bob Google",
        }),
      ),
    ).rejects.toThrow(/outside the current request scope/i);

    const bobList = await runWithRequestContext(
      { userEmail: "bob@example.com" },
      () => listWorkspaceConnections(),
    );
    expect(bobList).toEqual([]);

    const bobDeleted = await runWithRequestContext(
      { userEmail: "bob@example.com" },
      () => deleteWorkspaceConnection("conn-personal"),
    );
    expect(bobDeleted).toBe(false);
  });

  it("uses active org scope when present", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      getWorkspaceConnection,
      listWorkspaceConnections,
      upsertWorkspaceConnection,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-org",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        }),
    );

    const bobList = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(bobList).toHaveLength(1);
    expect(bobList[0]).toMatchObject({
      id: "conn-org",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    const updated = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-org",
          provider: "slack",
          label: "Updated Team Slack",
        }),
    );
    expect(updated.label).toBe("Updated Team Slack");

    const otherOrg = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => getWorkspaceConnection("conn-org"),
    );
    expect(otherOrg).toBeNull();
  });

  it("scopes workspace connection grants to the active org", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      getWorkspaceConnectionGrant,
      listWorkspaceConnectionGrants,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-shared",
          provider: "github",
          label: "Team GitHub",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-shared",
          appId: "dispatch",
          scopes: ["repo:read"],
        });
      },
    );

    const bobGrants = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnectionGrants({ appId: "dispatch" }),
    );
    expect(bobGrants).toHaveLength(1);
    expect(bobGrants[0]).toMatchObject({
      connectionId: "conn-shared",
      provider: "github",
      appId: "dispatch",
      ownerEmail: "alice@example.com",
      grantedByEmail: "alice@example.com",
      orgId: "org-1",
      scopes: ["repo:read"],
    });

    const bobGrant = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => getWorkspaceConnectionGrant("conn-shared", "dispatch"),
    );
    expect(bobGrant?.id).toBe(bobGrants[0].id);

    const otherOrgGrants = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => listWorkspaceConnectionGrants({ appId: "dispatch" }),
    );
    expect(otherOrgGrants).toEqual([]);
  });

  it("marks scoped workspace connection and grant usage metadata", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionProviderCatalogForApp,
      listWorkspaceConnectionGrants,
      listWorkspaceConnections,
      markWorkspaceConnectionUsed,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-used",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain",
          connectionId: "conn-used",
          appId: "brain",
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
      },
    );

    const usedAt = "2026-05-16T12:34:56.000Z";
    const marked = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        markWorkspaceConnectionUsed({
          connectionId: "conn-used",
          appId: "brain",
          usedAt,
        }),
    );
    expect(marked).toEqual({
      connectionUpdated: true,
      grantUpdated: true,
      lastUsedAt: usedAt,
    });

    const [connections, grants, catalog] = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        Promise.all([
          listWorkspaceConnections({ provider: "slack" }),
          listWorkspaceConnectionGrants({ connectionId: "conn-used" }),
          listWorkspaceConnectionProviderCatalogForApp({
            appId: "brain",
            provider: "slack",
          }),
        ]),
    );

    expect(connections[0]).toMatchObject({
      id: "conn-used",
      lastUsedAt: usedAt,
    });
    expect(grants[0]).toMatchObject({
      id: "grant-brain",
      lastUsedAt: usedAt,
    });
    expect(catalog.providers[0].workspaceConnection).toMatchObject({
      lastUsedAt: usedAt,
      connections: [
        expect.objectContaining({
          id: "conn-used",
          lastUsedAt: usedAt,
          explicitGrant: expect.objectContaining({
            id: "grant-brain",
            lastUsedAt: usedAt,
          }),
        }),
      ],
    });
  });

  it("filters connections by legacy allowed apps and explicit grants", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnections,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-open",
          provider: "slack",
          label: "Open Slack",
        });
        await upsertWorkspaceConnection({
          id: "conn-legacy-dispatch",
          provider: "gmail",
          label: "Legacy Dispatch Gmail",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnection({
          id: "conn-granted-dispatch",
          provider: "github",
          label: "Granted GitHub",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnection({
          id: "conn-brain-only",
          provider: "notion",
          label: "Brain Notion",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-granted-dispatch",
          appId: "dispatch",
        });
      },
    );

    const dispatchConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(
      dispatchConnections.map((connection) => connection.id).sort(),
    ).toEqual(["conn-granted-dispatch", "conn-legacy-dispatch", "conn-open"]);

    const brainConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "brain" }),
    );
    expect(brainConnections.map((connection) => connection.id).sort()).toEqual([
      "conn-brain-only",
      "conn-granted-dispatch",
      "conn-open",
    ]);
  });

  it("lists app-available workspace connections with access metadata", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionsForApp,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-open",
          provider: "slack",
          label: "Open Slack",
          config: { token: "xoxb-open-should-not-leak" },
          credentialRefs: [
            {
              key: "SLACK_BOT_TOKEN",
              scope: "org",
              value: "xoxb-ref-should-not-leak",
            },
          ],
        });
        await upsertWorkspaceConnection({
          id: "conn-allowed",
          provider: "slack",
          label: "Brain Slack",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnection({
          id: "conn-granted",
          provider: "slack",
          label: "Granted Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnection({
          id: "conn-not-granted",
          provider: "slack",
          label: "Dispatch Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain",
          connectionId: "conn-granted",
          appId: "brain",
        });
      },
    );

    const connections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        listWorkspaceConnectionsForApp({ appId: "brain", provider: "slack" }),
    );

    expect(connections.map((connection) => connection.id).sort()).toEqual([
      "conn-allowed",
      "conn-granted",
      "conn-open",
    ]);
    expect(
      connections.map((connection) => ({
        id: connection.id,
        appAccess: connection.appAccess,
        explicitGrantId: connection.explicitGrant?.id ?? null,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conn-open",
          appAccess: expect.objectContaining({
            available: true,
            mode: "all-apps",
          }),
          explicitGrantId: null,
        }),
        expect.objectContaining({
          id: "conn-allowed",
          appAccess: expect.objectContaining({
            available: true,
            mode: "allowed-app",
          }),
          explicitGrantId: null,
        }),
        expect.objectContaining({
          id: "conn-granted",
          appAccess: expect.objectContaining({
            available: true,
            mode: "explicit-grant",
            grantId: "grant-brain",
          }),
          explicitGrantId: "grant-brain",
        }),
      ]),
    );
    expect(JSON.stringify(connections)).not.toContain("xoxb-open");
    expect(JSON.stringify(connections)).not.toContain("xoxb-ref");
  });

  it("resolves requested app workspace connections with unavailable reasons", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { resolveWorkspaceConnectionForApp, upsertWorkspaceConnection } =
      await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-open",
          provider: "github",
          label: "Open GitHub",
        });
        await upsertWorkspaceConnection({
          id: "conn-dispatch",
          provider: "github",
          label: "Dispatch GitHub",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnection({
          id: "conn-disabled",
          provider: "github",
          label: "Disabled GitHub",
          status: "disabled",
        });
        await upsertWorkspaceConnection({
          id: "conn-needs-reauth",
          provider: "github",
          label: "Expired GitHub",
          status: "needs_reauth",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-open",
          requireConnected: true,
        }),
    );
    expect(resolved).toMatchObject({
      available: true,
      connection: {
        id: "conn-open",
        appAccess: {
          available: true,
          mode: "all-apps",
        },
      },
    });

    const notGranted = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-dispatch",
        }),
    );
    expect(notGranted).toMatchObject({
      available: false,
      connection: {
        id: "conn-dispatch",
        appAccess: {
          available: false,
          mode: "unavailable",
        },
      },
    });
    expect(notGranted.reason).toMatch(/grant brain access/i);

    const disabled = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-disabled",
        }),
    );
    expect(disabled).toMatchObject({
      available: false,
      connection: { id: "conn-disabled", status: "disabled" },
    });
    expect(disabled.reason).toMatch(/disabled/i);

    const needsConnected = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-needs-reauth",
          requireConnected: true,
          includeDisabled: true,
        }),
    );
    expect(needsConnected).toMatchObject({
      available: false,
      connection: { id: "conn-needs-reauth", status: "needs_reauth" },
    });
    expect(needsConnected.reason).toMatch(/connected workspace connection/i);

    const missing = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-missing",
        }),
    );
    expect(missing).toMatchObject({
      available: false,
      connection: null,
      appAccess: null,
    });
    expect(missing.reason).toMatch(/not found/i);
  });

  it("builds a reusable provider catalog for one app", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionProviderCatalogForApp,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-slack",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-slack",
          appId: "brain",
        });
      },
    );

    const catalog = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        listWorkspaceConnectionProviderCatalogForApp({
          appId: "brain",
          templateUse: "brain",
          provider: "slack",
        }),
    );

    expect(catalog).toMatchObject({
      appId: "brain",
      counts: {
        providers: 1,
        connections: 1,
        grants: 1,
        readyProviders: 1,
      },
    });
    expect(catalog.providers[0]).toMatchObject({
      id: "slack",
      workspaceConnection: {
        grantState: "connected",
        grantedConnectionCount: 1,
      },
      readiness: {
        status: "ready",
        missingRequiredCredentialKeys: [],
      },
    });
    expect(JSON.stringify(catalog)).not.toContain("xox");
  });

  it("revokes workspace connection grants without changing legacy allowed apps", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionGrants,
      listWorkspaceConnections,
      revokeWorkspaceConnectionGrant,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-granted",
          provider: "github",
          label: "Granted GitHub",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnection({
          id: "conn-legacy",
          provider: "gmail",
          label: "Legacy Gmail",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-granted",
          appId: "dispatch",
        });
      },
    );

    const otherOrgRevoked = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => revokeWorkspaceConnectionGrant("conn-granted", "dispatch"),
    );
    expect(otherOrgRevoked).toBe(false);

    const revoked = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => revokeWorkspaceConnectionGrant("conn-granted", "dispatch"),
    );
    expect(revoked).toBe(true);

    const grants = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnectionGrants({ appId: "dispatch" }),
    );
    expect(grants).toEqual([]);

    const dispatchConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(dispatchConnections.map((connection) => connection.id)).toEqual([
      "conn-legacy",
    ]);
  });

  it("redacts secret-shaped fields during serialization", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { serializeWorkspaceConnection, upsertWorkspaceConnection } =
      await import("./store.js");

    const saved = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-safe",
          provider: "openai",
          label: "OpenAI",
          config: {
            region: "us",
            apiKey: "sk-should-not-leak",
            nested: { accessToken: "token-should-not-leak" },
          },
          credentialRefs: [
            {
              key: "OPENAI_API_KEY",
              scope: "user",
              value: "raw-secret-should-not-leak",
            },
          ],
        }),
    );

    expect(JSON.stringify(saved)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(saved)).not.toContain("token-should-not-leak");
    expect(JSON.stringify(saved)).not.toContain("raw-secret-should-not-leak");
    expect(saved.config).toMatchObject({
      region: "us",
      apiKey: "[redacted]",
      nested: { accessToken: "[redacted]" },
    });
    expect(saved.credentialRefs[0]).toMatchObject({
      key: "OPENAI_API_KEY",
      scope: "user",
      value: "[redacted]",
    });

    const serialized = serializeWorkspaceConnection(saved);
    expect(JSON.stringify(serialized)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(serialized)).not.toContain("token-should-not-leak");
  });

  it("redacts secret-shaped grant fields during serialization", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      serializeWorkspaceConnectionGrant,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    const grant = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-grant-safe",
          provider: "slack",
          label: "Slack",
        });
        return upsertWorkspaceConnectionGrant({
          connectionId: "conn-grant-safe",
          appId: "dispatch",
          config: {
            channel: "alerts",
            apiKey: "sk-should-not-leak",
            nested: { refreshToken: "refresh-should-not-leak" },
          },
          credentialRefs: [
            {
              key: "SLACK_BOT_TOKEN",
              scope: "org",
              value: "raw-secret-should-not-leak",
            },
          ],
        });
      },
    );

    expect(JSON.stringify(grant)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(grant)).not.toContain("refresh-should-not-leak");
    expect(JSON.stringify(grant)).not.toContain("raw-secret-should-not-leak");
    expect(grant.config).toMatchObject({
      channel: "alerts",
      apiKey: "[redacted]",
      nested: { refreshToken: "[redacted]" },
    });
    expect(grant.credentialRefs[0]).toMatchObject({
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      value: "[redacted]",
    });

    const serialized = serializeWorkspaceConnectionGrant(grant);
    expect(JSON.stringify(serialized)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(serialized)).not.toContain("refresh-should-not-leak");
  });

  it("resolves runtime credentials from granted workspace connection refs", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const {
      getWorkspaceConnection,
      getWorkspaceConnectionGrant,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-slack",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain",
          connectionId: "conn-slack",
          appId: "brain",
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
        await writeAppSecret({
          key: "SLACK_BOT_TOKEN",
          value: "xoxb-runtime-token",
          scope: "org",
          scopeId: "org-1",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
        }),
    );

    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "xoxb-runtime-token",
      provenance: {
        source: "workspace_connection",
        provider: "slack",
        requestedKey: "SLACK_BOT_TOKEN",
        resolvedKey: "SLACK_BOT_TOKEN",
        connectionId: "conn-slack",
        connectionLabel: "Team Slack",
        grantId: "grant-brain",
        appAccessMode: "explicit-grant",
        secretScope: "org",
        backend: "secrets",
        credentialRef: {
          key: "SLACK_BOT_TOKEN",
          source: "grant",
        },
      },
    });

    const [connection, grant] = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        Promise.all([
          getWorkspaceConnection("conn-slack"),
          getWorkspaceConnectionGrant("conn-slack", "brain"),
        ]),
    );
    expect(connection?.lastUsedAt).toEqual(expect.any(String));
    expect(grant?.lastUsedAt).toEqual(expect.any(String));
    expect(Date.parse(connection?.lastUsedAt ?? "")).toBeGreaterThan(0);
    expect(grant?.lastUsedAt).toBe(connection?.lastUsedAt);
  }, 15_000);

  it("reports missing workspace connections and missing grants without reading env credentials", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    process.env.SLACK_BOT_TOKEN = "env-token-must-not-be-used";

    const missingConnection = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
        }),
    );
    expect(missingConnection).toMatchObject({
      available: false,
      status: "not_available",
    });
    expect(missingConnection.value).toBeUndefined();

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-dispatch",
          provider: "slack",
          label: "Dispatch Slack",
          allowedApps: ["dispatch"],
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        }),
    );

    const missingGrant = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
          connectionId: "conn-dispatch",
        }),
    );
    expect(missingGrant).toMatchObject({
      available: false,
      status: "not_available",
      checked: [
        expect.objectContaining({
          status: "not_available",
          connectionId: "conn-dispatch",
          appAccessMode: "unavailable",
        }),
      ],
    });
    expect(missingGrant.reason).toMatch(/grant brain access/i);
    expect(missingGrant.value).toBeUndefined();
  });

  it("resolves provider credential key aliases for workspace connection refs", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-hubspot",
          provider: "hubspot",
          label: "Team HubSpot",
          credentialRefs: [{ key: "HUBSPOT_PRIVATE_APP_TOKEN", scope: "org" }],
        });
        await writeAppSecret({
          key: "HUBSPOT_ACCESS_TOKEN",
          value: "pat-alias-token",
          scope: "org",
          scopeId: "org-1",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "analytics",
          provider: "hubspot",
          key: "HUBSPOT_ACCESS_TOKEN",
        }),
    );

    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "pat-alias-token",
      provenance: {
        requestedKey: "HUBSPOT_ACCESS_TOKEN",
        resolvedKey: "HUBSPOT_ACCESS_TOKEN",
        credentialRef: {
          key: "HUBSPOT_PRIVATE_APP_TOKEN",
          source: "connection",
        },
      },
    });
  });

  it("falls back to legacy scoped credentials and reports multi-key misses", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { saveCredential } = await import("../credentials/index.js");
    const { resolveWorkspaceConnectionCredentialsForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-github",
          provider: "github",
          label: "Team GitHub",
          credentialRefs: [
            { key: "GITHUB_TOKEN", scope: "org" },
            { key: "GITHUB_WEBHOOK_SECRET", scope: "org" },
          ],
        });
        await saveCredential("GITHUB_TOKEN", "legacy-github-token", {
          userEmail: "alice@example.com",
          orgId: "org-1",
          scope: "org",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialsForApp({
          appId: "brain",
          provider: "github",
          keys: ["GITHUB_TOKEN", "GITHUB_WEBHOOK_SECRET"],
        }),
    );

    expect(resolved).toMatchObject({
      available: false,
      values: { GITHUB_TOKEN: "legacy-github-token" },
      missingKeys: ["GITHUB_WEBHOOK_SECRET"],
      results: {
        GITHUB_TOKEN: {
          status: "resolved",
          provenance: {
            backend: "credentials",
            secretScope: "org",
          },
        },
        GITHUB_WEBHOOK_SECRET: {
          status: "missing_secret",
        },
      },
    });
  });
});
