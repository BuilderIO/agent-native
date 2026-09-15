import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

vi.mock("../audit/store.js", () => ({
  ensureAuditTables: vi.fn(async () => undefined),
}));

import { offboardMember } from "./offboard.js";

function dbExec(db: Awaited<ReturnType<typeof createTestPglite>>) {
  const exec = {
    async execute(query: { sql: string; args?: unknown[] }) {
      const result = await db.query(query.sql, query.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    async transaction<T>(run: (tx: typeof exec) => Promise<T>) {
      return run(exec);
    },
  };
  return exec;
}

describe("offboardMember", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>> | undefined;

  afterEach(async () => {
    await pglite?.close();
    pglite = undefined;
  });

  it("transfers owned rows, removes access, revokes sessions, and audits", async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE "session" (id TEXT PRIMARY KEY, "userId" TEXT);
      CREATE TABLE org_members (id TEXT PRIMARY KEY, org_id TEXT, email TEXT);
      CREATE TABLE app_member_roles (id TEXT PRIMARY KEY, org_id TEXT, email TEXT);
      CREATE TABLE workspace_apps (id TEXT PRIMARY KEY, org_id TEXT, owner_email TEXT);
      CREATE TABLE workspace_connection_grants (id TEXT PRIMARY KEY, org_id TEXT, owner_email TEXT, granted_by_email TEXT);
      CREATE TABLE workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT, member_emails_json TEXT);
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT,
        actor_kind TEXT, actor_email TEXT, org_id TEXT, target_type TEXT,
        target_id TEXT, status TEXT, summary TEXT, input TEXT,
        owner_email TEXT, visibility TEXT
      );
      INSERT INTO "user" VALUES ('old-id', 'old@example.test'), ('new-id', 'new@example.test');
      INSERT INTO "session" VALUES ('session-1', 'old-id');
      INSERT INTO org_members VALUES ('member-1', 'org-1', 'old@example.test');
      INSERT INTO app_member_roles VALUES ('role-1', 'org-1', 'old@example.test');
      INSERT INTO workspace_apps VALUES ('app-1', 'org-1', 'old@example.test');
      INSERT INTO workspace_connection_grants VALUES ('grant-1', 'org-1', 'old@example.test', 'old@example.test');
      INSERT INTO workspace_user_groups VALUES ('group-1', 'org-1', '["old@example.test","other@example.test"]');
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
      await pglite.prepare("SELECT owner_email FROM workspace_apps").get(),
    ).toEqual({ owner_email: "new@example.test" });
    expect(await pglite.prepare("SELECT email FROM org_members").all()).toEqual(
      [],
    );
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
  });

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
  });
});
