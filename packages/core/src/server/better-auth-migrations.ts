import { runMigrations, type MigrationEntry } from "../db/migrations.js";

async function assertBetterAuthUserIdentityColumns(): Promise<void> {
  const { getDbExec } = await import("../db/client.js");
  const { rows } = await getDbExec().execute(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user' AND column_name IN ('id', 'email')`,
  );
  const columnNames = rows.map((row) =>
    String(row.column_name ?? row[0] ?? ""),
  );

  const missing = ["id", "email"].filter(
    (column) => !columnNames.includes(column),
  );
  if (missing.length > 0) {
    throw new Error(
      `Cannot repair the Better Auth "user" table because required identity column(s) are missing: ${missing.join(", ")}. Restore the existing user schema before deploying this migration.`,
    );
  }
}

/**
 * Better Auth encrypts persisted JWT private keys with the current auth
 * secret. If that secret is rotated, the old row remains the newest key and
 * every token-producing request fails before it can mint a replacement. Mark
 * active rows expired during the release so Better Auth rotates the signing
 * key without touching users or sessions. The JWKS endpoint keeps expired
 * keys during its grace period, so already-issued short-lived tokens remain
 * verifiable while the new key propagates.
 *
 * Also invoked at runtime by `jwks-secret-rotation.ts` when a live request
 * hits the decrypt failure — release migrations do not reach every deployed
 * database, so the release-time pass alone cannot be relied on.
 */
export async function expireJwksKeysAfterAuthSecretRotation(): Promise<void> {
  const { getDbExec } = await import("../db/client.js");
  const now = new Date().toISOString();
  const result = await getDbExec().execute({
    sql: `UPDATE "jwks" SET expires_at = ? WHERE expires_at IS NULL OR expires_at > ?`,
    args: [now, now],
  });
  if (result.rowsAffected > 0) {
    console.info(
      `[auth] Expired ${result.rowsAffected} Better Auth JWKS key(s) after auth-secret rotation; public keys remain in the verification grace period.`,
    );
  }
}

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
    },
  },
  {
    version: 2,
    name: "better-auth-repair-user-columns",
    sql: {
      // `CREATE TABLE IF NOT EXISTS` does not reconcile an older table that
      // already has the Better Auth name but is missing newer columns. Keep
      // this repair additive so existing user rows and legacy auth data stay
      // intact while the adapter gets the columns it selects on signup.
      postgres: `
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '';
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "image" TEXT;
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      `,
    },
    run: assertBetterAuthUserIdentityColumns,
  },
  {
    version: 3,
    name: "legacy-auth-sessions-table",
    sql: {
      // `addSession()` is still used by the mobile/deep-link OAuth flow and
      // the workspace callback. Provision its legacy table in the release
      // runtime so those request paths only perform normal row writes.
      postgres: `
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          email TEXT,
          created_at BIGINT NOT NULL
        )
      `,
    },
  },
  {
    version: 4,
    name: "better-auth-jwks-key-rotation-recovery",
    sql: {},
    run: expireJwksKeysAfterAuthSecretRotation,
  },
  {
    version: 5,
    name: "better-auth-add-onboarding-role",
    sql: {
      postgres: `
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboarding_role" TEXT
      `,
    },
  },
  {
    version: 5,
    name: "better-auth-user-lower-email-index",
    sql: {
      postgres:
        'CREATE INDEX IF NOT EXISTS better_auth_user_lower_email_idx ON "user" (LOWER(email))',
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
