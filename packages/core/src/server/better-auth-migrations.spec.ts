import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { BETTER_AUTH_MIGRATIONS } from "./better-auth-migrations.js";

function postgresSql(name: string): string {
  const migration = BETTER_AUTH_MIGRATIONS.find((entry) => entry.name === name);
  expect(migration).toBeDefined();
  return typeof migration?.sql === "string"
    ? migration.sql
    : (migration?.sql.postgres ?? "");
}

describe("Better Auth migrations", () => {
  it("repairs a legacy user table without replacing its rows", async () => {
    const db = await createTestPglite();
    await db.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
      INSERT INTO "user" (id, email) VALUES ('user-1', 'user@example.com')`);
    await db.exec(postgresSql("better-auth-repair-user-columns"));
    const columns = await db
      .prepare(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'user' ORDER BY ordinal_position",
      )
      .all();
    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "email",
      "name",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
    ]);
    await expect(
      db
        .prepare(
          'SELECT id, name, email, email_verified, image, created_at, updated_at FROM "user" WHERE email = ?',
        )
        .get("user@example.com"),
    ).resolves.toMatchObject({
      id: "user-1",
      email: "user@example.com",
      name: "",
      email_verified: false,
    });
    await db.exec(postgresSql("better-auth-repair-user-columns"));
    await db.close();
  });

  it("uses PostgreSQL defaults for the repair", () => {
    expect(postgresSql("better-auth-repair-user-columns")).toContain(
      '"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  it("provisions the legacy sessions table for release-time OAuth flows", () => {
    expect(postgresSql("legacy-auth-sessions-table")).toContain(
      "created_at BIGINT NOT NULL",
    );
  });

  it("rotates persisted JWKS keys after an auth-secret change", () => {
    const rotation = BETTER_AUTH_MIGRATIONS.find(
      (migration) =>
        migration.name === "better-auth-jwks-key-rotation-recovery",
    );
    expect(rotation?.version).toBe(4);
    expect(rotation?.sql).toEqual({});
    expect(rotation?.run).toEqual(expect.any(Function));
  });

  it("adds the nullable onboarding role column for Better Auth users", () => {
    expect(postgresSql("better-auth-add-onboarding-role")).toContain(
      'ADD COLUMN IF NOT EXISTS "onboarding_role" TEXT',
    );
  });

  it("adds the first-touch columns in one idempotent statement that keeps existing users", async () => {
    const sql = postgresSql("better-auth-user-first-touch-attribution");
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(8);

    const db = await createTestPglite();
    await db.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
      INSERT INTO "user" (id, email) VALUES ('user-1', 'user@example.com')`);
    await db.exec(sql);
    await db.exec(sql);
    const columns = await db
      .prepare(
        "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'user' AND column_name LIKE 'first_touch_%' ORDER BY column_name",
      )
      .all();
    expect(columns.map((column) => column.column_name)).toEqual([
      "first_touch_gclid",
      "first_touch_msclkid",
      "first_touch_referrer",
      "first_touch_utm_campaign",
      "first_touch_utm_medium",
      "first_touch_utm_source",
      "first_touch_utm_term",
      "first_touch_vector_source",
    ]);
    expect(columns.every((column) => column.is_nullable === "YES")).toBe(true);
    await expect(
      db
        .prepare('SELECT id FROM "user" WHERE email = ?')
        .get("user@example.com"),
    ).resolves.toMatchObject({ id: "user-1" });
    await db.close();
  });

  it("indexes case-insensitive legacy session verification lookups", () => {
    expect(postgresSql("better-auth-user-lower-email-index")).toContain(
      'ON "user" (LOWER(email))',
    );
  });

  it("adds the Better Auth 1.7 jwks key metadata columns", async () => {
    const db = await createTestPglite();
    await db.exec(`CREATE TABLE "jwks" (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ
      );
      INSERT INTO "jwks" (id, public_key, private_key, created_at)
        VALUES ('key-1', 'public', 'private', CURRENT_TIMESTAMP)`);
    await db.exec(postgresSql("better-auth-jwks-alg-crv-columns"));
    const columns = await db
      .prepare(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'jwks' ORDER BY ordinal_position",
      )
      .all();
    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "public_key",
      "private_key",
      "created_at",
      "expires_at",
      "alg",
      "crv",
    ]);
    await expect(
      db.prepare('SELECT alg, crv FROM "jwks" WHERE id = ?').get("key-1"),
    ).resolves.toMatchObject({ alg: null, crv: null });
    await db.exec(postgresSql("better-auth-jwks-alg-crv-columns"));
    await db.close();
  });

  it("provisions opt-in TOTP storage without replacing existing users", async () => {
    const db = await createTestPglite();
    await db.exec(
      `CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
       INSERT INTO "user" (id, email) VALUES ('user-1', 'user@example.com')`,
    );
    await db.exec(postgresSql("better-auth-two-factor-tables"));
    await db.exec(postgresSql("better-auth-two-factor-tables"));
    await expect(
      db
        .prepare('SELECT two_factor_enabled FROM "user" WHERE id = ?')
        .get("user-1"),
    ).resolves.toMatchObject({ two_factor_enabled: false });
    const columns = await db
      .prepare(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'twoFactor' ORDER BY ordinal_position",
      )
      .all();
    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "secret",
      "backup_codes",
      "user_id",
      "verified",
      "failed_verification_count",
      "locked_until",
    ]);
    await db.close();
  });
});
