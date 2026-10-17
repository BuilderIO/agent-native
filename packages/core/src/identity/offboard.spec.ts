import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { __resetSchemaSnapshotForTests } from "../db/ddl-guard.js";
import {
  ensureConnectTables,
  lookupConnectTokenOrg,
  recordMintedToken,
} from "../mcp/connect-store.js";
import { withMcpCredentialIssuance } from "../mcp/credential-issuance.js";
import {
  createOAuthCode,
  createOAuthRefreshToken,
  ensureOAuthTables,
  getOAuthCode,
  getOAuthRefreshToken,
} from "../mcp/oauth-store.js";

const issuanceDb = vi.hoisted(() => ({
  exec: undefined as DbExec | undefined,
}));
vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => issuanceDb.exec ?? actual.getDbExec() };
});

vi.mock("../audit/store.js", () => ({
  ensureAuditTables: vi.fn(async () => undefined),
}));

import { offboardMember } from "./offboard.js";
import {
  __resetAppIdentityColumnsForTests,
  registerIdentityColumns,
} from "./rekey.js";
import { identityCredentialLockKey } from "./retired-emails.js";

function dbExec(db: Awaited<ReturnType<typeof createTestPglite>>): DbExec {
  const wrap = (client: {
    query: (sql: string, args?: unknown[]) => Promise<any>;
  }): DbExec => ({
    async execute(query) {
      const statement = typeof query === "string" ? { sql: query } : query;
      const result = await client.query(
        postgresSql(statement.sql),
        statement.args ?? [],
      );
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
  });
  const postgresSql = (sql: string): string => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  const exec = wrap(db);
  exec.transaction = (run) =>
    db.db.transaction((tx: any) => run(wrap(tx) as any));
  return exec;
}

describe("offboardMember", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>> | undefined;

  afterEach(async () => {
    issuanceDb.exec = undefined;
    __resetSchemaSnapshotForTests();
    await pglite?.close();
    pglite = undefined;
    __resetAppIdentityColumnsForTests();
  });

  it("locks the removed member before taking the credential schema snapshot or sweeping credentials", async () => {
    const queries: string[] = [];
    const tx = {
      execute: vi.fn(
        async ({ sql, args }: { sql: string; args?: unknown[] }) => {
          queries.push(sql);
          if (sql.includes("information_schema.columns")) {
            return {
              rows: [
                ...[
                  "id",
                  "org_id",
                  "email",
                  "federation_removal_pending_at",
                ].map((column_name) => ({
                  table_name: "org_members",
                  column_name,
                })),
                ...[
                  "id",
                  "owner_email",
                  "issued_for_email",
                  "org_id",
                  "revoked_at",
                ].map((column_name) => ({
                  table_name: "mcp_oauth_refresh_tokens",
                  column_name,
                })),
              ],
              rowsAffected: 0,
            };
          }
          if (sql.includes("FOR UPDATE")) {
            expect(args).toEqual(["old@example.test", "org-1"]);
            return { rows: [{ id: "old-member" }], rowsAffected: 0 };
          }
          if (sql.startsWith("SELECT"))
            return { rows: [{ id: "successor" }], rowsAffected: 0 };
          return { rows: [], rowsAffected: 1 };
        },
      ),
    };
    const db = {
      execute: vi.fn(async () => {
        throw new Error("offboarding escaped its transaction");
      }),
      transaction: async <T>(run: (executor: typeof tx) => Promise<T>) =>
        run(tx),
    };
    await offboardMember(db, "old@example.test", {
      transferTo: "new@example.test",
      orgId: "org-1",
    });
    const lock = queries.findIndex((sql) => sql.includes("FOR UPDATE"));
    const mutations = queries.flatMap((sql, index) =>
      /^(UPDATE|DELETE|INSERT)/.test(sql) ? [index] : [],
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    const schemaRead = queries.findIndex((sql) =>
      sql.includes("information_schema.columns"),
    );
    expect(schemaRead).toBeGreaterThan(lock);
    expect(queries[lock]).toMatch(/ORDER BY org_id, id FOR UPDATE/);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((index) => index > lock)).toBe(true);
    expect(
      queries.some((sql) => sql.includes('UPDATE "mcp_oauth_refresh_tokens"')),
    ).toBe(true);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["an organization", "org-1"],
    ["the whole account", undefined],
  ])(
    "takes the Personal issuance lock before any row lock when offboarding from %s",
    async (_scope, orgId) => {
      const queries: Array<{ sql: string; args?: unknown[] }> = [];
      const tx = {
        execute: vi.fn(async (query: { sql: string; args?: unknown[] }) => {
          queries.push(query);
          if (query.sql.includes("information_schema.columns"))
            return { rows: [], rowsAffected: 0 };
          if (query.sql.startsWith("SELECT"))
            return { rows: [{ id: "row" }], rowsAffected: 0 };
          return { rows: [], rowsAffected: 1 };
        }),
      };
      await offboardMember(
        { execute: vi.fn(), transaction: async (run: any) => run(tx) },
        "Old@Example.test",
        { transferTo: "new@example.test", orgId },
      );
      const lock = queries.findIndex(({ sql }) =>
        sql.includes("pg_advisory_xact_lock"),
      );
      expect(lock).toBe(0);
      expect(queries[lock].args).toEqual([
        identityCredentialLockKey("old@example.test"),
      ]);
      expect(
        queries.findIndex(({ sql }) => sql.includes("FOR UPDATE")),
      ).toBeGreaterThan(lock);
    },
  );

  it("sweeps first-time Connect and OAuth issuance committed before the member lock and keeps grants revoked after re-add", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY, identity_authority TEXT, identity_id TEXT);
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT, role TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      INSERT INTO organizations VALUES ('org-1', NULL, NULL);
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', 'member', NULL),
        ('member-2', 'org-1', 'new@example.test', 'member', NULL);
    `);
    const exec = dbExec(pglite);
    issuanceDb.exec = exec;
    expect(
      await pglite
        .prepare("SELECT to_regclass('mcp_connect_tokens') AS name")
        .get(),
    ).toEqual({ name: null });

    let issued = false;
    let oauthCode = "";
    const snapshots: string[][] = [];
    const tx: DbExec = {
      async execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FOR UPDATE")) {
          expect(issued).toBe(false);
          issued = true;
          await ensureConnectTables();
          await ensureOAuthTables();
          await withMcpCredentialIssuance(
            { orgId: "org-1", email: "old@example.test" },
            async (issuer) => {
              await recordMintedToken(
                {
                  jti: "example-first-connect-grant",
                  ownerEmail: "old@example.test",
                  orgId: "org-1",
                },
                issuer,
              );
              const grant = {
                clientId: "example-oauth-client",
                ownerEmail: "old@example.test",
                orgId: "org-1",
                scope: "mcp",
                resource: "https://app.example.test/mcp",
                grantCreatedAtMs: Date.now(),
              };
              oauthCode = (
                await createOAuthCode(
                  {
                    ...grant,
                    redirectUri: "https://client.example.test/callback",
                    codeChallenge: "example-pkce-challenge",
                    codeChallengeMethod: "S256",
                  },
                  issuer,
                )
              ).code;
              await createOAuthRefreshToken(
                { ...grant, refreshToken: "example-first-oauth-refresh" },
                issuer,
              );
            },
          );
          expect(
            await lookupConnectTokenOrg("example-first-connect-grant"),
          ).toMatchObject({ status: "found" });
        }
        const result = await exec.execute(query);
        if (sql.includes("information_schema.columns")) {
          snapshots.push(result.rows.map((row) => String(row.table_name)));
        }
        return result;
      },
    };
    // Stage a separate issuer commit before the fence. PGlite cannot run
    // concurrent transaction sessions; the adapter test proves tx use.
    await offboardMember(
      {
        execute: async () => {
          throw new Error("offboarding escaped its transaction");
        },
        transaction: async (run) => run(tx),
      },
      "old@example.test",
      { transferTo: "new@example.test", orgId: "org-1" },
    );
    expect(issued).toBe(true);
    await pglite.exec(`
      INSERT INTO org_members VALUES
        ('readded-member', 'org-1', 'old@example.test', 'member', NULL);
    `);
    expect(await lookupConnectTokenOrg("example-first-connect-grant")).toEqual({
      status: "revoked",
    });
    expect(await getOAuthCode(oauthCode)).toBeNull();
    expect(
      await getOAuthRefreshToken("example-first-oauth-refresh"),
    ).toBeNull();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toContain("mcp_connect_tokens");
    expect(snapshots[0]).toContain("mcp_device_codes");
    expect(snapshots[0]).toContain("mcp_oauth_codes");
    expect(snapshots[0]).toContain("mcp_oauth_refresh_tokens");
    expect(
      await pglite.prepare("SELECT owner_email FROM mcp_connect_tokens").all(),
    ).toEqual([{ owner_email: "old@example.test" }]);
    expect(
      await pglite
        .prepare(
          "SELECT owner_email, issued_for_email, revoked_at FROM mcp_oauth_refresh_tokens",
        )
        .get(),
    ).toEqual({
      owner_email: "old@example.test",
      issued_for_email: "old@example.test",
      revoked_at: expect.any(Number),
    });
  }, 30_000);

  it("refuses missing membership schema without transferring account-owned rows", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE workspace_connections (id TEXT PRIMARY KEY, owner_email TEXT);
      INSERT INTO "user" VALUES ('old-id', 'old@example.test'), ('new-id', 'new@example.test');
      INSERT INTO workspace_connections VALUES ('connection-1', 'old@example.test');
    `);
    await expect(
      offboardMember(dbExec(pglite), "old@example.test", {
        transferTo: "new@example.test",
      }),
    ).rejects.toThrow('relation "org_members" does not exist');
    expect(
      await pglite
        .prepare("SELECT owner_email FROM workspace_connections")
        .get(),
    ).toEqual({ owner_email: "old@example.test" });
  }, 30_000);

  it("transfers owned rows, removes access, revokes sessions, and audits", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE "session" (id TEXT PRIMARY KEY, "userId" TEXT);
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE app_member_roles (id TEXT PRIMARY KEY, org_id TEXT, email TEXT);
      CREATE TABLE workspace_apps (id TEXT PRIMARY KEY, org_id TEXT, owner_email TEXT);
      CREATE TABLE workspace_connection_grants (id TEXT PRIMARY KEY, org_id TEXT, owner_email TEXT, granted_by_email TEXT);
      CREATE TABLE workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT, member_emails_json TEXT);
      CREATE TABLE account_owned_rows (id TEXT PRIMARY KEY, owner_email TEXT);
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      INSERT INTO "user" VALUES ('old-id', 'old@example.test'), ('new-id', 'new@example.test');
      INSERT INTO "session" VALUES ('session-1', 'old-id');
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', NULL),
        ('member-2', 'org-1', 'new@example.test', NULL);
      INSERT INTO app_member_roles VALUES ('role-1', 'org-1', 'old@example.test');
      INSERT INTO workspace_apps VALUES
        ('app-1', 'org-1', 'old@example.test'),
        ('app-2', 'org-2', 'old@example.test');
      INSERT INTO workspace_connection_grants VALUES
        ('grant-1', 'org-1', 'old@example.test', 'old@example.test'),
        ('grant-2', 'org-1', 'old@example.test', 'other@example.test'),
        ('grant-3', 'org-2', 'old@example.test', 'other@example.test');
      INSERT INTO workspace_user_groups VALUES ('group-1', 'org-1', '["old@example.test","other@example.test"]');
      INSERT INTO account_owned_rows VALUES ('account-row-1', 'old@example.test');
    `);

    const result = await offboardMember(dbExec(pglite), "old@example.test", {
      transferTo: "new@example.test",
      orgId: "org-1",
      actorEmail: "admin@example.test",
    });

    expect(result.removedMemberships).toBe(1);
    expect(result.removedAppRoles).toBe(1);
    expect(result.revokedSessions).toBe(1);
    expect(
      await pglite
        .prepare("SELECT owner_email FROM workspace_apps WHERE id = 'app-1'")
        .get(),
    ).toEqual({ owner_email: "new@example.test" });
    expect(
      await pglite
        .prepare("SELECT owner_email FROM workspace_apps WHERE id = 'app-2'")
        .get(),
    ).toEqual({ owner_email: "old@example.test" });
    expect(
      await pglite.prepare("SELECT owner_email FROM account_owned_rows").get(),
    ).toEqual({ owner_email: "old@example.test" });
    expect(
      await pglite
        .prepare("SELECT id FROM workspace_connection_grants ORDER BY id ASC")
        .all(),
    ).toEqual([{ id: "grant-3" }]);
    expect(
      await pglite
        .prepare(
          "SELECT email FROM org_members WHERE LOWER(email) = 'old@example.test'",
        )
        .all(),
    ).toEqual([]);
    expect(
      await pglite
        .prepare("SELECT member_emails_json FROM workspace_user_groups")
        .get(),
    ).toEqual({ member_emails_json: '["other@example.test"]' });
    expect(
      await pglite
        .prepare("SELECT action, target_id FROM agent_audit_log")
        .get(),
    ).toEqual({
      action: "org.member.offboarded",
      target_id: "old@example.test",
    });
  }, 30_000);

  it("refuses a missing successor before changing anything", async () => {
    pglite = await createTestPglite();
    await pglite.exec(
      `CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);`,
    );
    await expect(
      offboardMember(dbExec(pglite), "old@example.test", {
        transferTo: "new@example.test",
      }),
    ).rejects.toThrow("Transfer target does not exist");
  }, 30_000);

  it("requires the successor to be active in the requested organization", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE workspace_apps (id TEXT PRIMARY KEY, org_id TEXT, owner_email TEXT);
      INSERT INTO "user" VALUES ('old-id', 'old@example.test'), ('new-id', 'new@example.test');
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', NULL),
        ('member-2', 'org-2', 'new@example.test', NULL);
      INSERT INTO workspace_apps VALUES ('app-1', 'org-1', 'old@example.test');
    `);

    await expect(
      offboardMember(dbExec(pglite), "old@example.test", {
        transferTo: "new@example.test",
        orgId: "org-1",
      }),
    ).rejects.toThrow(
      "Transfer target must be an active member of the organization",
    );
    expect(
      await pglite
        .prepare("SELECT owner_email FROM workspace_apps WHERE id = 'app-1'")
        .get(),
    ).toEqual({ owner_email: "old@example.test" });
  }, 30_000);

  it("refuses an unregistered identity column before changing the roster", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE future_members (id TEXT PRIMARY KEY, created_by TEXT);
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', NULL),
        ('member-2', 'org-1', 'new@example.test', NULL);
    `);

    await expect(
      offboardMember(dbExec(pglite), "old@example.test", {
        transferTo: "new@example.test",
        orgId: "org-1",
      }),
    ).rejects.toThrow("future_members.created_by looks identity-bearing");
    expect(
      await pglite.prepare("SELECT email FROM org_members ORDER BY id").all(),
    ).toEqual([{ email: "old@example.test" }, { email: "new@example.test" }]);
  }, 30_000);

  it("keeps sessions when the member remains active in another organization", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE "session" (id TEXT PRIMARY KEY, "userId" TEXT);
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE app_member_roles (id TEXT PRIMARY KEY, org_id TEXT, email TEXT);
      CREATE TABLE workspace_connection_grants (
        id TEXT PRIMARY KEY, org_id TEXT, owner_email TEXT, granted_by_email TEXT
      );
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      INSERT INTO "user" VALUES ('old-id', 'old@example.test'), ('new-id', 'new@example.test');
      INSERT INTO "session" VALUES ('session-1', 'old-id'), ('session-2', 'old-id');
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', NULL),
        ('member-2', 'org-1', 'new@example.test', NULL),
        ('member-3', 'org-2', 'old@example.test', NULL);
    `);

    const result = await offboardMember(dbExec(pglite), "old@example.test", {
      transferTo: "new@example.test",
      orgId: "org-1",
    });

    expect(result.revokedSessions).toBe(0);
    expect(
      await pglite
        .prepare('SELECT COUNT(*)::int AS count FROM "session"')
        .get(),
    ).toEqual({ count: 2 });
  }, 30_000);

  it("uses the shared identity registry for account-wide cleanup", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE "session" (id TEXT PRIMARY KEY, "userId" TEXT);
      CREATE TABLE org_members (id TEXT PRIMARY KEY, org_id TEXT, email TEXT, federation_removal_pending_at BIGINT);
      CREATE TABLE app_member_roles (id TEXT PRIMARY KEY, org_id TEXT, email TEXT);
      CREATE TABLE workspace_connection_grants (id TEXT PRIMARY KEY, owner_email TEXT, granted_by_email TEXT);
      CREATE TABLE workspace_connections (id TEXT PRIMARY KEY, owner_email TEXT);
      CREATE TABLE app_secrets (id TEXT PRIMARY KEY, scope TEXT, scope_id TEXT);
      CREATE TABLE application_state (session_id TEXT, key TEXT, value TEXT);
      CREATE TABLE chat_thread_shares (id TEXT PRIMARY KEY, principal_type TEXT, principal_id TEXT);
      CREATE TABLE oauth_tokens (provider TEXT, account_id TEXT, owner TEXT);
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      INSERT INTO "user" VALUES ('old-id', 'old@example.test'), ('new-id', 'new@example.test');
      INSERT INTO "session" VALUES ('session-1', 'old-id');
      INSERT INTO org_members VALUES ('member-1', NULL, 'old@example.test', NULL);
      INSERT INTO workspace_connections VALUES ('connection-1', 'old@example.test');
      INSERT INTO app_secrets VALUES ('secret-1', 'user', 'old@example.test');
      INSERT INTO application_state VALUES ('old@example.test', 'navigation', '{}');
      INSERT INTO chat_thread_shares VALUES ('share-1', 'user', 'old@example.test');
      INSERT INTO oauth_tokens VALUES ('github', 'account-1', 'user:old@example.test');
    `);

    const result = await offboardMember(dbExec(pglite), "old@example.test", {
      transferTo: "new@example.test",
      actorEmail: "admin@example.test",
    });

    expect(result.transferredRows).toBe(1);
    expect(
      await pglite
        .prepare("SELECT owner_email FROM workspace_connections")
        .get(),
    ).toEqual({ owner_email: "new@example.test" });
    expect(
      await pglite
        .prepare("SELECT COUNT(*)::int AS count FROM app_secrets")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      await pglite
        .prepare("SELECT COUNT(*)::int AS count FROM chat_thread_shares")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      await pglite
        .prepare("SELECT COUNT(*)::int AS count FROM oauth_tokens")
        .get(),
    ).toEqual({ count: 0 });
    const audit = await pglite
      .prepare("SELECT input FROM agent_audit_log")
      .get();
    expect(JSON.parse(audit.input).cleanupCounts).toMatchObject({
      "app_secrets.scope_id": 1,
      "chat_thread_shares.principal_id": 1,
      "oauth_tokens.owner": 1,
    });
  }, 30_000);

  it("revokes or deletes the member's MCP credentials instead of handing them to the successor", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      CREATE TABLE mcp_oauth_refresh_tokens (
        id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT, revoked_at BIGINT
      );
      CREATE TABLE mcp_oauth_codes (id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT);
      CREATE TABLE mcp_device_codes (id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT);
      CREATE TABLE mcp_connect_tokens (
        id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT, kind TEXT,
        created_by TEXT, revoked_at BIGINT
      );
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', NULL),
        ('member-2', 'org-1', 'new@example.test', NULL);
      INSERT INTO mcp_oauth_refresh_tokens VALUES
        ('refresh-org-1', 'old@example.test', 'org-1', NULL),
        ('refresh-org-2', 'old@example.test', 'org-2', NULL),
        ('refresh-personal', 'old@example.test', NULL, NULL),
        ('refresh-other-user', 'other@example.test', 'org-1', NULL);
      INSERT INTO mcp_oauth_codes VALUES
        ('code-org-1', 'old@example.test', 'org-1'),
        ('code-org-2', 'old@example.test', 'org-2');
      INSERT INTO mcp_device_codes VALUES
        ('device-org-1', 'old@example.test', 'org-1'),
        ('device-org-2', 'old@example.test', 'org-2');
      INSERT INTO mcp_connect_tokens VALUES
        ('connect-org-1', 'old@example.test', 'org-1', 'personal', NULL, NULL),
        ('connect-already-revoked', 'old@example.test', 'org-1', 'personal', NULL, 42),
        ('connect-org-2', 'old@example.test', 'org-2', 'personal', NULL, NULL),
        ('service-token', 'svc-ci@service.org-1', 'org-1', 'service', 'old@example.test', NULL);
      ALTER TABLE mcp_oauth_refresh_tokens ADD COLUMN issued_for_email TEXT;
      UPDATE mcp_oauth_refresh_tokens SET issued_for_email = owner_email;
      ALTER TABLE mcp_oauth_codes ADD COLUMN issued_for_email TEXT;
      UPDATE mcp_oauth_codes SET issued_for_email = owner_email;
    `);

    const result = await offboardMember(dbExec(pglite), "old@example.test", {
      transferTo: "new@example.test",
      orgId: "org-1",
    });

    expect(result.transferredRows).toBe(0);
    const rows = async (table: string) =>
      (await pglite!
        .prepare(
          `SELECT id, owner_email, ${
            table.includes("tokens") ? "revoked_at" : "NULL AS revoked_at"
          } FROM ${table} ORDER BY id`,
        )
        .all()) as Array<{
        id: string;
        owner_email: string;
        revoked_at: number | null;
      }>;
    const revoked = (row: { revoked_at: number | null } | undefined) =>
      Number(row?.revoked_at) > 0;

    const refresh = await rows("mcp_oauth_refresh_tokens");
    expect(
      await pglite
        .prepare(
          "SELECT issued_for_email FROM mcp_oauth_refresh_tokens WHERE id = 'refresh-org-1'",
        )
        .get(),
    ).toEqual({ issued_for_email: "old@example.test" });
    expect(refresh.map((row) => row.owner_email)).not.toContain(
      "new@example.test",
    );
    expect(
      Object.fromEntries(refresh.map((row) => [row.id, revoked(row)])),
    ).toEqual({
      "refresh-org-1": true,
      "refresh-org-2": false,
      "refresh-other-user": false,
      "refresh-personal": false,
    });

    // Connect tokens are revoked, never deleted: a missing row reads as live.
    const connect = await rows("mcp_connect_tokens");
    expect(connect.map((row) => row.owner_email)).not.toContain(
      "new@example.test",
    );
    expect(connect.find((row) => row.id === "connect-org-1")).toSatisfy(
      revoked,
    );
    expect(
      Number(
        connect.find((row) => row.id === "connect-already-revoked")?.revoked_at,
      ),
    ).toBe(42);
    expect(connect.find((row) => row.id === "connect-org-2")).toMatchObject({
      revoked_at: null,
    });
    // An org service token outlives the member who created it.
    expect(
      await pglite
        .prepare(
          "SELECT owner_email, created_by, revoked_at FROM mcp_connect_tokens WHERE id = 'service-token'",
        )
        .get(),
    ).toEqual({
      owner_email: "svc-ci@service.org-1",
      created_by: "old@example.test",
      revoked_at: null,
    });

    expect((await rows("mcp_oauth_codes")).map((row) => row.id)).toEqual([
      "code-org-2",
    ]);
    expect((await rows("mcp_device_codes")).map((row) => row.id)).toEqual([
      "device-org-2",
    ]);
  }, 30_000);

  it("refuses a revoke policy on a table that cannot record revocation, before changing the roster", async () => {
    registerIdentityColumns([
      {
        table: "app_api_keys",
        column: "owner_email",
        emailChange: "rekey",
        offboard: "revoke",
        reason: "Bearer keys act as their owner.",
      },
    ]);
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT,
        federation_removal_pending_at BIGINT
      );
      CREATE TABLE app_api_keys (id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT);
      INSERT INTO org_members VALUES
        ('member-1', 'org-1', 'old@example.test', NULL),
        ('member-2', 'org-1', 'new@example.test', NULL);
      INSERT INTO app_api_keys VALUES ('key-1', 'old@example.test', 'org-1');
    `);

    await expect(
      offboardMember(dbExec(pglite), "old@example.test", {
        transferTo: "new@example.test",
        orgId: "org-1",
      }),
    ).rejects.toThrow("app_api_keys.revoked_at is missing");
    expect(
      await pglite.prepare("SELECT email FROM org_members ORDER BY id").all(),
    ).toEqual([{ email: "old@example.test" }, { email: "new@example.test" }]);
    expect(
      await pglite.prepare("SELECT owner_email FROM app_api_keys").get(),
    ).toEqual({ owner_email: "old@example.test" });
  }, 30_000);
});
