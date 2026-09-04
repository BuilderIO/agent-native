import { describe, it, expect, vi, afterEach } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

/**
 * Regression coverage for the `acceptPendingInvitationsForEmail` TOCTOU race
 * (packages/core/src/org/accept-pending.ts): a SELECT-then-INSERT check with
 * no unique constraint standing behind the case-insensitive comparison every
 * reader uses. Two concurrent acceptances of the same pending invitation
 * (e.g. a retried Better Auth signup hook) used to both pass the SELECT and
 * both INSERT, producing a duplicate `org_members` row.
 *
 * Unlike storage.spec.ts's mocked-`execute` fixture, this uses a real
 * in-memory PGlite database — including the unique expression index
 * added in migrations.ts (org-members-unique-lower-email-idx) — so the
 * `ON CONFLICT (org_id, LOWER(email)) DO NOTHING` insert is exercised
 * against genuine constraint enforcement, not a captured-SQL mock.
 */

function createPgliteExec(
  pglite: Awaited<ReturnType<typeof createTestPglite>>,
) {
  return {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : (input.args ?? []);
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith("SELECT")) {
        const rows = await pglite.prepare(sql).all(...(args as any[]));
        return { rows, rowsAffected: 0 };
      }
      const info = await pglite.prepare(sql).run(...(args as any[]));
      return { rows: [], rowsAffected: info.changes };
    },
  };
}

async function seedOrgTables(
  pglite: Awaited<ReturnType<typeof createTestPglite>>,
) {
  await pglite.exec(`
    CREATE TABLE org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      status TEXT NOT NULL,
      role TEXT
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      UNIQUE(org_id, email)
    );
    CREATE UNIQUE INDEX org_members_org_lower_email_uidx
      ON org_members (org_id, LOWER(email));
  `);
}

async function loadAcceptPendingWithPglite(
  pglite: Awaited<ReturnType<typeof createTestPglite>>,
) {
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => createPgliteExec(pglite),
    isLocalDatabase: () => true,
  }));
  vi.doMock("../settings/user-settings.js", () => ({
    putUserSetting: vi.fn(async () => {}),
  }));
  const mod = await import("./accept-pending.js");
  return mod;
}

describe("acceptPendingInvitationsForEmail (real pglite, concurrency)", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
    vi.doUnmock("../settings/user-settings.js");
  });

  it("processing the same invitation twice concurrently yields exactly one membership row", async () => {
    const pglite = await createTestPglite();
    await seedOrgTables(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status, role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "inv1",
        "org1",
        "a@b.com",
        "owner@b.com",
        Date.now(),
        "pending",
        "member",
      );

    const { acceptPendingInvitationsForEmail } =
      await loadAcceptPendingWithPglite(pglite);

    // Simulates a retried signup hook calling the acceptance path twice for
    // the same email before either has committed its INSERT.
    const results = await Promise.all([
      acceptPendingInvitationsForEmail("a@b.com"),
      acceptPendingInvitationsForEmail("a@b.com"),
    ]);

    // Neither call throws (previously the race's loser hit a raw UNIQUE
    // constraint violation).
    for (const r of results) {
      expect(r.accepted).toEqual([{ invitationId: "inv1", orgId: "org1" }]);
    }

    const { count } = (await pglite
      .prepare(`SELECT COUNT(*) as count FROM org_members`)
      .get()) as { count: number };
    expect(count).toBe(1);

    const member = (await pglite
      .prepare(`SELECT org_id, email, role FROM org_members`)
      .get()) as { org_id: string; email: string; role: string };
    expect(member).toEqual({
      org_id: "org1",
      email: "a@b.com",
      role: "member",
    });

    await pglite.close();
  });

  it("a case-variant duplicate row does not block idempotent acceptance", async () => {
    const pglite = await createTestPglite();
    await seedOrgTables(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status, role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "inv1",
        "org1",
        "a@b.com",
        "owner@b.com",
        Date.now(),
        "pending",
        "member",
      );
    // Pre-existing legacy row with different casing — the exact-string
    // UNIQUE(org_id, email) constraint never caught this, only the new
    // expression index does.
    await pglite
      .prepare(
        `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("member1", "org1", "A@B.com", "member", Date.now());

    const { acceptPendingInvitationsForEmail } =
      await loadAcceptPendingWithPglite(pglite);

    await expect(
      acceptPendingInvitationsForEmail("a@b.com"),
    ).resolves.toMatchObject({
      accepted: [{ invitationId: "inv1", orgId: "org1" }],
    });

    const { count } = (await pglite
      .prepare(`SELECT COUNT(*) as count FROM org_members`)
      .get()) as { count: number };
    expect(count).toBe(1);

    await pglite.close();
  });
});
