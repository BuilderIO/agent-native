import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDbExec, getDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { runFrameworkReleaseMigrations } from "../server/release-migrations.js";
import { offboardMember } from "./offboard.js";
import {
  __resetAppIdentityColumnsForTests,
  registerIdentityColumns,
  rekeyIdentity,
  resolveIdentityColumns,
  type IdentityRekeyDb,
} from "./rekey.js";

// The registry is only complete if it covers what the framework's own
// migrations create; a hand-written fixture schema cannot show that.
let previousDatabaseUrl: string | undefined;

async function schemaRows() {
  const result = await getDbExec().execute(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  return result.rows as Array<Record<string, unknown>>;
}

async function rows(sql: string, args: unknown[] = []) {
  return (await getDbExec().execute({ sql, args })).rows as Array<
    Record<string, unknown>
  >;
}

function rekeyDb(): IdentityRekeyDb {
  const exec = getDbExec();
  return {
    async unsafe(sql, args = []) {
      const result = await exec.execute({ sql, args });
      const out = result.rows as Array<Record<string, unknown>> & {
        count?: number;
      };
      out.count = result.rowsAffected;
      return out;
    },
  };
}

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
  await withMigrationRuntime(() => runFrameworkReleaseMigrations(null));
}, 120_000);

afterAll(async () => {
  __resetAppIdentityColumnsForTests();
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("identity registry against the migrated framework schema", () => {
  it("has a policy for every identity-shaped framework column", async () => {
    expect(() => resolveIdentityColumns([])).not.toThrow();
    expect(resolveIdentityColumns(await schemaRows()).length).toBeGreaterThan(
      0,
    );
  });

  it("dry-runs an email change across the whole schema", async () => {
    await rows(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ('rekey-user', 'Rekey', 'rekey-old@example.test', true, now(), now())`,
    );
    await rows(
      `INSERT INTO "session" (id, token, user_id, expires_at, created_at, updated_at)
       VALUES ('rekey-session', 'rekey-token', 'rekey-user', now(), now(), now())`,
    );
    const result = await rekeyIdentity(
      rekeyDb(),
      "rekey-old@example.test",
      "rekey-new@example.test",
      { dryRun: true },
    );
    expect(result.counts["user.email"]).toBe(1);
    // Migrated Better Auth sessions key on user_id, not "userId".
    expect(result.sessionCount).toBe(1);
  });

  it("offboards a member with app-declared and share-shaped tables", async () => {
    const db = getDbExec();
    await db.execute(`
      CREATE TABLE app_spaces (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL)
    `);
    await db.execute(`
      CREATE TABLE app_space_members (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, email TEXT NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE app_notes (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT,
        author_email TEXT
      )
    `);
    await db.execute(`
      CREATE TABLE app_note_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL, principal_id TEXT NOT NULL,
        role TEXT NOT NULL, created_by TEXT NOT NULL
      )
    `);

    const now = Date.now();
    await db.execute(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
        ('leaver', 'Leaver', 'leaver@example.test', true, now(), now()),
        ('successor', 'Successor', 'successor@example.test', true, now(), now())
    `);
    await db.execute({
      sql: `INSERT INTO organizations (id, name, created_by, created_at)
            VALUES ('org-1', 'One', 'successor@example.test', ?),
                   ('org-2', 'Two', 'successor@example.test', ?)`,
      args: [now, now],
    });
    await db.execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES
              ('m-leaver', 'org-1', 'leaver@example.test', 'member', ?),
              ('m-successor', 'org-1', 'successor@example.test', 'owner', ?),
              ('m-leaver-2', 'org-2', 'leaver@example.test', 'member', ?)`,
      args: [now, now, now],
    });
    await db.execute(`
      INSERT INTO app_spaces VALUES ('space-1', 'org-1'), ('space-2', 'org-2');
    `);
    await db.execute(`
      INSERT INTO app_space_members VALUES
        ('sm-1', 'space-1', 'leaver@example.test'),
        ('sm-2', 'space-2', 'leaver@example.test');
    `);
    await db.execute(`
      INSERT INTO app_notes VALUES
        ('note-1', 'leaver@example.test', 'org-1', 'leaver@example.test'),
        ('note-2', 'leaver@example.test', 'org-2', 'leaver@example.test');
    `);
    await db.execute(`
      INSERT INTO app_note_shares VALUES
        ('share-1', 'note-3', 'user', 'leaver@example.test', 'viewer', 'successor@example.test');
    `);

    await expect(
      offboardMember(db, "leaver@example.test", {
        transferTo: "successor@example.test",
        orgId: "org-1",
      }),
    ).rejects.toThrow(/^app_notes\.author_email .*registerIdentityColumns\(\)/);
    expect(
      await rows(
        `SELECT id FROM org_members WHERE email = 'leaver@example.test' ORDER BY id`,
      ),
    ).toEqual([{ id: "m-leaver" }, { id: "m-leaver-2" }]);

    registerIdentityColumns([
      {
        table: "app_space_members",
        column: "email",
        emailChange: "rekey",
        offboard: "delete",
        orgScope: {
          column: "space_id",
          references: {
            table: "app_spaces",
            column: "id",
            orgColumn: "workspace_id",
          },
        },
        reason: "Space membership grants access.",
      },
      {
        table: "app_notes",
        column: "author_email",
        emailChange: "rekey",
        offboard: "retain",
        reason: "Author attribution.",
      },
    ]);

    const result = await offboardMember(db, "leaver@example.test", {
      transferTo: "successor@example.test",
      orgId: "org-1",
    });

    expect(result.removedMemberships).toBe(1);
    expect(await rows(`SELECT id FROM app_space_members ORDER BY id`)).toEqual([
      { id: "sm-2" },
    ]);
    expect(
      await rows(
        `SELECT id, owner_email, author_email FROM app_notes ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "note-1",
        owner_email: "successor@example.test",
        author_email: "leaver@example.test",
      },
      {
        id: "note-2",
        owner_email: "leaver@example.test",
        author_email: "leaver@example.test",
      },
    ]);
    // Share tables have no org column, so an org-scoped removal leaves
    // account-wide grants alone, like the framework's own share tables.
    expect(await rows(`SELECT id FROM app_note_shares`)).toEqual([
      { id: "share-1" },
    ]);
    expect(
      await rows(
        `SELECT org_id FROM org_members WHERE email = 'leaver@example.test'`,
      ),
    ).toEqual([{ org_id: "org-2" }]);

    await db.execute(`
      INSERT INTO "session" (id, token, user_id, expires_at, created_at, updated_at)
      VALUES ('leaver-session', 'leaver-token', 'leaver', now(), now(), now())
    `);
    const accountWide = await offboardMember(db, "leaver@example.test", {
      transferTo: "successor@example.test",
    });
    expect(accountWide.removedMemberships).toBe(1);
    expect(accountWide.revokedSessions).toBe(1);
    expect(await rows(`SELECT id FROM app_note_shares`)).toEqual([]);
    expect(await rows(`SELECT id FROM app_space_members`)).toEqual([]);
  });

  // Apps that don't mount workspace connections or app roles (Clips) never
  // migrate those tables; offboarding must not assume they exist.
  it("offboards when optional framework tables were never migrated", async () => {
    const db = getDbExec();
    await db.execute(`DROP TABLE IF EXISTS workspace_connection_grants`);
    await db.execute(`DROP TABLE IF EXISTS app_member_roles`);
    const now = Date.now();
    await db.execute(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
        ('plain-leaver', 'Plain', 'plain-leaver@example.test', true, now(), now())
    `);
    await db.execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
            VALUES ('m-plain', 'org-1', 'plain-leaver@example.test', 'member', ?)`,
      args: [now],
    });

    const result = await offboardMember(db, "plain-leaver@example.test", {
      transferTo: "successor@example.test",
      orgId: "org-1",
    });

    expect(result.removedMemberships).toBe(1);
    expect(result.removedAppRoles).toBe(0);
    expect(
      await rows(
        `SELECT id FROM org_members WHERE email = 'plain-leaver@example.test'`,
      ),
    ).toEqual([]);
  });
});

describe("registerIdentityColumns", () => {
  it("refuses declarations that would silently weaken a policy", () => {
    const base = {
      table: "app_things",
      column: "email",
      emailChange: "rekey",
      offboard: "delete",
      reason: "Membership.",
    } as const;
    expect(() =>
      registerIdentityColumns([{ ...base, table: "org_members" }]),
    ).toThrow(/owned by the framework registry/);
    expect(() => registerIdentityColumns([{ ...base, reason: " " }])).toThrow(
      /needs a reason/,
    );
    expect(() =>
      registerIdentityColumns([{ ...base, table: "app_things; DROP" }]),
    ).toThrow(/Invalid identity column identifier/);
    expect(() =>
      registerIdentityColumns([
        { ...base, mode: "secret-scope", offboard: "transfer" },
      ]),
    ).toThrow(/secret-scoped/);
    registerIdentityColumns([base]);
    expect(() =>
      registerIdentityColumns([{ ...base, offboard: "retain" }]),
    ).toThrow(/declared twice with different policies/);
  });
});
