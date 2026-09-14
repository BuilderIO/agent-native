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

  it("indexes case-insensitive legacy session verification lookups", () => {
    expect(postgresSql("better-auth-user-lower-email-index")).toContain(
      'ON "user" (LOWER(email))',
    );
  });
});
