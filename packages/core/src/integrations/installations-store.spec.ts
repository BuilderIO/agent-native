import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  queries: [] as Array<string | { sql: string; args?: unknown[] }>,
}));
const writeSecretMock = vi.hoisted(() => vi.fn(async () => "secret-id"));
const readSecretMock = vi.hoisted(() => vi.fn());
const deleteSecretMock = vi.hoisted(() => vi.fn(async () => true));

function sqlOf(input: string | { sql: string }): string {
  return (typeof input === "string" ? input : input.sql).trim();
}

async function execute(input: string | { sql: string; args?: unknown[] }) {
  state.queries.push(input);
  const sql = sqlOf(input);
  const args = typeof input === "string" ? [] : (input.args ?? []);
  if (/^CREATE (?:UNIQUE )?(?:TABLE|INDEX)/i.test(sql)) {
    return { rows: [], rowsAffected: 0 };
  }
  if (
    /^SELECT \* FROM integration_installations WHERE platform = \?/i.test(sql)
  ) {
    const row = state.rows.find(
      (candidate) =>
        candidate.platform === args[0] &&
        candidate.installation_key === args[1],
    );
    return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
  }
  if (/^SELECT \* FROM integration_installations WHERE id = \?/i.test(sql)) {
    const row = state.rows.find((candidate) => candidate.id === args[0]);
    return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
  }
  if (/^INSERT INTO integration_installations/i.test(sql)) {
    state.rows.push({
      id: args[0],
      platform: args[1],
      installation_key: args[2],
      team_id: args[3],
      team_name: args[4],
      enterprise_id: args[5],
      enterprise_name: args[6],
      is_enterprise_install: args[7],
      api_app_id: args[8],
      bot_user_id: args[9],
      scopes_json: args[10],
      installed_by_external_user_id: args[11],
      owner_email: args[12],
      org_id: args[13],
      token_secret_key: args[14],
      secret_scope: args[15],
      secret_scope_id: args[16],
      status: args[17],
      health: args[18],
      last_error: args[19],
      health_checked_at: args[20],
      last_healthy_at: args[21],
      token_expires_at: args[22],
      created_at: args[23],
      updated_at: args[24],
      disconnected_at: args[25],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE integration_installations SET\s+team_id/i.test(sql)) {
    const row = state.rows.find((candidate) => candidate.id === args[22]);
    if (!row) return { rows: [], rowsAffected: 0 };
    Object.assign(row, {
      team_id: args[0],
      team_name: args[1],
      enterprise_id: args[2],
      enterprise_name: args[3],
      is_enterprise_install: args[4],
      api_app_id: args[5],
      bot_user_id: args[6],
      scopes_json: args[7],
      installed_by_external_user_id: args[8],
      owner_email: args[9],
      org_id: args[10],
      token_secret_key: args[11],
      secret_scope: args[12],
      secret_scope_id: args[13],
      status: args[14],
      health: args[15],
      last_error: args[16],
      health_checked_at: args[17],
      last_healthy_at: args[18],
      token_expires_at: args[19],
      updated_at: args[20],
      disconnected_at: args[21],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE integration_installations SET team_name/i.test(sql)) {
    const row = state.rows.find((candidate) => candidate.id === args[11]);
    if (!row) return { rows: [], rowsAffected: 0 };
    Object.assign(row, {
      team_name: args[0],
      enterprise_name: args[1],
      bot_user_id: args[2],
      scopes_json: args[3],
      status: args[4],
      health: args[5],
      last_error: args[6],
      health_checked_at: args[7],
      last_healthy_at: args[8],
      token_expires_at: args[9],
      updated_at: args[10],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (
    /^UPDATE integration_installations SET status = 'disconnected'/i.test(sql)
  ) {
    const row = state.rows.find((candidate) => candidate.id === args[2]);
    if (!row) return { rows: [], rowsAffected: 0 };
    Object.assign(row, {
      status: "disconnected",
      health: "unknown",
      last_error: null,
      token_expires_at: null,
      disconnected_at: args[0],
      updated_at: args[1],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^SELECT \* FROM integration_installations WHERE /i.test(sql)) {
    let rows = state.rows.filter(
      (row) => row.owner_email === args[0] || row.org_id === args[1],
    );
    if (sql.includes("AND platform = ?")) {
      rows = rows.filter((row) => row.platform === args.at(-1));
    }
    return {
      rows: rows.sort(
        (a, b) => Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0),
      ),
      rowsAffected: 0,
    };
  }
  throw new Error(`Unhandled SQL: ${sql}`);
}

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(),
  ensureIndexExists: vi.fn(),
}));

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: writeSecretMock,
  readAppSecret: readSecretMock,
  deleteAppSecret: deleteSecretMock,
}));

const store = await import("./installations-store.js");

function installationInput(overrides: Record<string, unknown> = {}) {
  return {
    platform: "slack",
    installationKey: "team:T123:app:A123",
    teamId: "T123",
    teamName: "Example workspace",
    apiAppId: "A123",
    botUserId: "U-BOT",
    scopes: ["chat:write", "app_mentions:read"],
    ownerEmail: "OWNER@EXAMPLE.COM",
    orgId: "org-1",
    secretScope: "org" as const,
    secretScopeId: "org-1",
    tokenBundle: {
      accessToken: "xoxb-example-not-real",
      refreshToken: "xoxe-example-not-real",
      expiresAt: 12345,
    },
    ...overrides,
  };
}

describe("managed integration installation store", () => {
  beforeEach(() => {
    state.rows = [];
    state.queries = [];
    vi.clearAllMocks();
    readSecretMock.mockResolvedValue(null);
  });

  it("stores token bundles only through app_secrets and returns safe metadata", async () => {
    const installation =
      await store.upsertIntegrationInstallation(installationInput());

    expect(writeSecretMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "org",
        scopeId: "org-1",
        value: expect.stringContaining("xoxb-example-not-real"),
      }),
    );
    expect(JSON.stringify(state.queries)).not.toContain(
      "xoxb-example-not-real",
    );
    expect(installation).toMatchObject({
      platform: "slack",
      ownerEmail: "owner@example.com",
      scopes: ["app_mentions:read", "chat:write"],
      tokenExpiresAt: 12345,
    });
    expect(installation).not.toHaveProperty("tokenSecretKey");
    expect(installation).not.toHaveProperty("secretScopeId");
    expect(installation).not.toHaveProperty("tokenBundle");
  });

  it("rotates a token in place for the same tenant", async () => {
    const first =
      await store.upsertIntegrationInstallation(installationInput());
    const second = await store.upsertIntegrationInstallation(
      installationInput({
        teamName: "Renamed workspace",
        tokenBundle: { accessToken: "xoxb-example-rotated" },
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.teamName).toBe("Renamed workspace");
    expect(state.rows).toHaveLength(1);
    expect(writeSecretMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to move a provider installation across tenants", async () => {
    await store.upsertIntegrationInstallation(installationInput());

    await expect(
      store.upsertIntegrationInstallation(
        installationInput({
          ownerEmail: "attacker@example.com",
          orgId: "org-2",
          secretScopeId: "org-2",
        }),
      ),
    ).rejects.toThrow("another owner or organization");
    expect(writeSecretMock).toHaveBeenCalledTimes(1);
  });

  it("lists only owner or active-org metadata", async () => {
    await store.upsertIntegrationInstallation(installationInput());
    await store.upsertIntegrationInstallation(
      installationInput({
        installationKey: "team:T999:app:A123",
        teamId: "T999",
        ownerEmail: "other@example.com",
        orgId: "org-2",
        secretScopeId: "org-2",
      }),
    );

    const visible = await store.listIntegrationInstallations({
      userEmail: "member@example.com",
      orgId: "org-1",
    });
    expect(visible.map((item) => item.teamId)).toEqual(["T123"]);
    expect(visible[0]).not.toHaveProperty("tokenSecretKey");
  });

  it("requires ownership or same-org admin rights to disconnect", async () => {
    const installation =
      await store.upsertIntegrationInstallation(installationInput());

    await expect(
      store.disconnectIntegrationInstallation(installation.id, {
        userEmail: "member@example.com",
        orgId: "org-1",
        isOrgAdmin: false,
      }),
    ).rejects.toThrow("do not have access");
    expect(deleteSecretMock).not.toHaveBeenCalled();

    await expect(
      store.disconnectIntegrationInstallation(installation.id, {
        userEmail: "owner@example.com",
        orgId: "org-1",
        isOrgAdmin: false,
      }),
    ).rejects.toThrow("do not have access");

    const disconnected = await store.disconnectIntegrationInstallation(
      installation.id,
      {
        userEmail: "admin@example.com",
        orgId: "org-1",
        isOrgAdmin: true,
      },
    );
    expect(deleteSecretMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org", scopeId: "org-1" }),
    );
    expect(disconnected?.status).toBe("disconnected");
  });

  it("materializes tokens only through the explicit trusted-runtime helper", async () => {
    await store.upsertIntegrationInstallation(installationInput());
    readSecretMock.mockResolvedValue({
      value: JSON.stringify({ accessToken: "xoxb-example-runtime" }),
      last4: "••••time",
      updatedAt: 1,
    });

    await expect(
      store.resolveIntegrationTokenBundle("slack", "team:T123:app:A123"),
    ).resolves.toEqual({ accessToken: "xoxb-example-runtime" });
  });
});
