import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { BETTER_AUTH_MIGRATIONS } from "./better-auth-migrations.js";

describe("Better Auth migrations", () => {
  it("repairs a legacy user table without replacing its rows", () => {
    const db = new Database(":memory:");
    db.exec(
      `CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
       INSERT INTO user (id, email) VALUES ('user-1', 'user@example.com');`,
    );

    const repair = BETTER_AUTH_MIGRATIONS.find(
      (migration) => migration.name === "better-auth-repair-user-columns",
    );
    expect(repair).toBeDefined();
    const sqliteSql = repair?.sql;
    expect(typeof sqliteSql).toBe("object");
    if (!sqliteSql || typeof sqliteSql === "string") return;

    const statements = sqliteSql.sqlite
      .split(";")
      .map((statement) =>
        statement.replace(/ADD COLUMN IF NOT EXISTS/gi, "ADD COLUMN").trim(),
      )
      .filter(Boolean);
    for (const statement of statements) db.exec(statement);

    const columns = db.prepare("PRAGMA table_info(user)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "email",
      "name",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
    ]);
    expect(
      db
        .prepare(
          'SELECT id, name, email, email_verified, image, created_at, updated_at FROM "user" WHERE email = ?',
        )
        .get("user@example.com"),
    ).toMatchObject({
      id: "user-1",
      email: "user@example.com",
      name: "",
      email_verified: 0,
    });

    // The migration runner strips IF NOT EXISTS for SQLite and swallows the
    // duplicate-column error, so a second release run is safe.
    for (const statement of statements) {
      try {
        db.exec(statement);
      } catch (error) {
        expect(String(error)).toMatch(/duplicate column name/i);
      }
    }

    db.close();
  });

  it("uses dialect-appropriate defaults for the repair", () => {
    const repair = BETTER_AUTH_MIGRATIONS.find(
      (migration) => migration.name === "better-auth-repair-user-columns",
    );
    expect(repair?.version).toBe(2);
    expect(repair?.sql).toMatchObject({
      postgres: expect.stringContaining(
        '"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      ),
      sqlite: expect.stringContaining("created_at INTEGER NOT NULL DEFAULT 0"),
    });
  });

  it("provisions the legacy sessions table for release-time OAuth flows", () => {
    const sessions = BETTER_AUTH_MIGRATIONS.find(
      (migration) => migration.name === "legacy-auth-sessions-table",
    );
    expect(sessions?.version).toBe(3);
    expect(sessions?.sql).toMatchObject({
      postgres: expect.stringContaining("created_at BIGINT NOT NULL"),
      sqlite: expect.stringContaining("created_at INTEGER NOT NULL"),
    });
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

<<<<<<< HEAD
  it("indexes case-insensitive legacy session verification lookups", () => {
    const index = BETTER_AUTH_MIGRATIONS.find(
      (migration) => migration.name === "better-auth-user-lower-email-index",
    );
    expect(index?.version).toBe(5);
    expect(index?.sql).toMatchObject({
      postgres: expect.stringContaining('ON "user" (LOWER(email))'),
      sqlite: expect.stringContaining("ON user (LOWER(email))"),
=======
  it("adds the nullable onboarding role column for Better Auth users", () => {
    const onboardingRole = BETTER_AUTH_MIGRATIONS.find(
      (migration) => migration.name === "better-auth-add-onboarding-role",
    );
    expect(onboardingRole?.version).toBe(5);
    expect(onboardingRole?.sql).toMatchObject({
      postgres: expect.stringContaining('"onboarding_role" TEXT'),
      sqlite: expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS onboarding_role TEXT",
      ),
>>>>>>> origin/main
    });
  });
});
