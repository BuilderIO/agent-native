import { runMigrations, type MigrationEntry } from "../db/migrations.js";

/**
 * Better Auth's framework-owned schema. This is deliberately a release
 * migration, not a fallback inside `getBetterAuth()`: request functions must
 * be able to construct the auth adapter without probing or creating tables.
 */
export const BETTER_AUTH_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "better-auth-core-tables",
    sql: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "user" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          email_verified BOOLEAN NOT NULL DEFAULT FALSE,
          image TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "session" (
          id TEXT PRIMARY KEY,
          expires_at TIMESTAMPTZ NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          user_id TEXT NOT NULL,
          active_organization_id TEXT
        );
        CREATE TABLE IF NOT EXISTS "account" (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          id_token TEXT,
          access_token_expires_at TIMESTAMPTZ,
          refresh_token_expires_at TIMESTAMPTZ,
          scope TEXT,
          password TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "verification" (
          id TEXT PRIMARY KEY,
          identifier TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "organization" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          logo TEXT,
          metadata TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "member" (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "invitation" (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          expires_at TIMESTAMPTZ NOT NULL,
          inviter_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "jwks" (
          id TEXT PRIMARY KEY,
          public_key TEXT NOT NULL,
          private_key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ
        )
      `,
      sqlite: `
        CREATE TABLE IF NOT EXISTS user (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          email_verified INTEGER NOT NULL DEFAULT 0,
          image TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS session (
          id TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          user_id TEXT NOT NULL,
          active_organization_id TEXT
        );
        CREATE TABLE IF NOT EXISTS account (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          id_token TEXT,
          access_token_expires_at INTEGER,
          refresh_token_expires_at INTEGER,
          scope TEXT,
          password TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verification (
          id TEXT PRIMARY KEY,
          identifier TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS organization (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          logo TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS member (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invitation (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          expires_at INTEGER NOT NULL,
          inviter_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jwks (
          id TEXT PRIMARY KEY,
          public_key TEXT NOT NULL,
          private_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER
        )
      `,
    },
  },
];

export async function runBetterAuthMigrations(
  nitroApp: unknown,
): Promise<void> {
  await runMigrations(BETTER_AUTH_MIGRATIONS, {
    table: "_better_auth_migrations",
  })(nitroApp);
}
