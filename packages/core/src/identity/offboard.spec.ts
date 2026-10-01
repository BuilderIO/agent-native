import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

vi.mock("../audit/store.js", () => ({
  ensureAuditTables: vi.fn(async () => undefined),
}));

import { offboardMember } from "./offboard.js";
import {
  __resetAppIdentityColumnsForTests,
  registerIdentityColumns,
} from "./rekey.js";

function dbExec(db: Awaited<ReturnType<typeof createTestPglite>>) {
  const wrap = (client: {
    query: (sql: string, args?: unknown[]) => Promise<any>;
  }) => ({
    async execute(query: { sql: string; args?: unknown[] }) {
      const result = await client.query(
        postgresSql(query.sql),
        query.args ?? [],
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
  const exec = wrap(db as any) as {
    execute: (query: { sql: string; args?: unknown[] }) => Promise<any>;
    transaction<T>(run: (tx: any) => Promise<T>): Promise<T>;
  };
  exec.transaction = (run) =>
    db.db.transaction((tx: any) => run(wrap(tx) as any));
  return exec;
}

describe("offboardMember", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>> | undefined;

  afterEach(async () => {
    await pglite?.close();
    pglite = undefined;
    __resetAppIdentityColumnsForTests();
  });

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
