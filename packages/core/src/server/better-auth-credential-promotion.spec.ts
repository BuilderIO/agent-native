import { describe, it, expect, vi, afterEach } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

/**
 * `ensureGoogleAuthIdentityWithAdapter`'s account-set read is only a fast path;
 * `replaceUnverifiedCredentialWithGoogle` revalidates it inside the transaction
 * that owns the user row. Both gates therefore have to agree on which accounts
 * count as a competing claim, and only this test exercises the SQL one: a
 * cross-app SSO user (unusable credential plus the inert `agent-native` link)
 * was refused here even after the fast path let them through.
 */

type Pglite = Awaited<ReturnType<typeof createTestPglite>>;

function createPgliteExec(pglite: Pglite) {
  const run = async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);
    if (sql.trim().toUpperCase().startsWith("SELECT")) {
      const rows = await pglite.prepare(sql).all(...(args as any[]));
      return { rows, rowsAffected: 0 };
    }
    const info = await pglite.prepare(sql).run(...(args as any[]));
    return { rows: [], rowsAffected: info.changes };
  };
  return {
    execute: run,
    // PGlite is single-connection, so the callback runs against the same
    // session the BEGIN opened. That is what makes FOR UPDATE and the advisory
    // lock in the transaction meaningful here.
    async transaction<T>(fn: (tx: { execute: typeof run }) => Promise<T>) {
      await pglite.exec("BEGIN");
      try {
        const result = await fn({ execute: run });
        await pglite.exec("COMMIT");
        return result;
      } catch (error) {
        await pglite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function seedAuthTables(pglite: Pglite) {
  await pglite.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TEXT
    );
    CREATE TABLE "account" (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  await pglite
    .prepare(
      `INSERT INTO "user" (id, email, email_verified) VALUES (?, ?, FALSE)`,
    )
    .run("user-1", "owner@example.test");
}

async function addAccount(
  pglite: Pglite,
  id: string,
  providerId: string,
  accountId: string,
) {
  await pglite
    .prepare(
      `INSERT INTO "account" (id, account_id, provider_id, user_id) VALUES (?, ?, ?, ?)`,
    )
    .run(id, accountId, providerId, "user-1");
}

async function loadWithPglite(pglite: Pglite) {
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => createPgliteExec(pglite),
    isLocalDatabase: () => true,
    onSharedDbPoolsClosed: () => {},
    onSharedDbPoolReplaced: () => {},
    sharedDbPool: () => undefined,
    closeDbExec: async () => {},
  }));
  const mod = await import("./better-auth-instance.js");
  return mod.replaceUnverifiedCredentialWithGoogle;
}

async function providerIds(pglite: Pglite): Promise<string[]> {
  const rows = (await pglite
    .prepare(`SELECT provider_id FROM "account" WHERE user_id = ?`)
    .all("user-1")) as Array<{ provider_id: string }>;
  return rows.map((row) => row.provider_id).sort();
}

describe("replaceUnverifiedCredentialWithGoogle (real pglite)", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("promotes a cross-app SSO user, keeping the identity-SSO link", async () => {
    const pglite = await createTestPglite();
    await seedAuthTables(pglite);
    await addAccount(pglite, "cred-1", "credential", "owner@example.test");
    await addAccount(pglite, "sso-1", "agent-native", "owner@example.test");
    const promote = await loadWithPglite(pglite);

    await promote({
      userId: "user-1",
      email: "owner@example.test",
      accountId: "google-sub-1",
    });

    expect(await providerIds(pglite)).toEqual(["agent-native", "google"]);
    const [user] = (await pglite
      .prepare(`SELECT email_verified FROM "user" WHERE id = ?`)
      .all("user-1")) as Array<{ email_verified: boolean }>;
    expect(user.email_verified).toBe(true);
    // Booting PGlite and loading this module graph costs more than the default.
  }, 30_000);

  it("refuses to promote when a third-party account also holds the address", async () => {
    const pglite = await createTestPglite();
    await seedAuthTables(pglite);
    await addAccount(pglite, "cred-1", "credential", "owner@example.test");
    await addAccount(pglite, "sso-1", "agent-native", "owner@example.test");
    await addAccount(pglite, "gh-1", "github", "github-sub-1");
    const promote = await loadWithPglite(pglite);

    await expect(
      promote({
        userId: "user-1",
        email: "owner@example.test",
        accountId: "google-sub-1",
      }),
    ).rejects.toThrow("ambiguous unverified identity");

    expect(await providerIds(pglite)).toEqual([
      "agent-native",
      "credential",
      "github",
    ]);
    const [user] = (await pglite
      .prepare(`SELECT email_verified FROM "user" WHERE id = ?`)
      .all("user-1")) as Array<{ email_verified: boolean }>;
    expect(user.email_verified).toBe(false);
  }, 30_000);
});
