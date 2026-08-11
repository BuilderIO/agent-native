import { runMigrations, type MigrationEntry } from "../db/migrations.js";

async function assertBetterAuthUserIdentityColumns(): Promise<void> {
  const { getCloudflareD1Binding, getDbExec, getDialect, isPostgres } =
    await import("../db/client.js");
  const dialect = getDialect();
  let columnNames: string[];

  if (dialect === "d1") {
    const d1 = getCloudflareD1Binding() as
      | { prepare(sql: string): { all(): Promise<{ results: unknown[] }> } }
      | undefined;
    if (!d1) {
      throw new Error(
        'Cannot inspect the Better Auth "user" table because the D1 binding is unavailable.',
      );
    }
    const result = await d1.prepare("PRAGMA table_info(user)").all();
    columnNames = result.results.map((column) => {
      const record = column as { name?: unknown };
      return typeof record.name === "string" ? record.name : "";
    });
  } else if (isPostgres()) {
    const { rows } = await getDbExec().execute(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user' AND column_name IN ('id', 'email')`,
    );
    columnNames = rows.map((row) => String(row.column_name ?? row[0] ?? ""));
  } else {
    const { rows } = await getDbExec().execute("PRAGMA table_info(user)");
    columnNames = rows.map((row) => String(row.name ?? row[1] ?? ""));
  }

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
      sqlite: `
        ALTER TABLE user ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
        ALTER TABLE user ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE user ADD COLUMN IF NOT EXISTS image TEXT;
        ALTER TABLE user ADD COLUMN IF NOT EXISTS created_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE user ADD COLUMN IF NOT EXISTS updated_at INTEGER NOT NULL DEFAULT 0
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
      sqlite: `
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          email TEXT,
          created_at INTEGER NOT NULL
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
