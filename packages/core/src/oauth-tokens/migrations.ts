import type { MigrationEntry } from "../db/migrations.js";

export const OAUTH_TOKEN_MIGRATIONS_TABLE = "_oauth_token_migrations";

export const OAUTH_TOKEN_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "oauth-tokens-table",
    sql: `CREATE TABLE IF NOT EXISTS oauth_tokens (
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      tokens TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, account_id)
    )`,
  },
  {
    version: 2,
    name: "oauth-tokens-owner-column",
    sql: `ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS owner TEXT`,
  },
  {
    version: 3,
    name: "oauth-tokens-display-name-column",
    sql: `ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS display_name TEXT`,
  },
  {
    version: 4,
    name: "oauth-tokens-owner-backfill",
    sql: `UPDATE oauth_tokens SET owner = account_id WHERE owner IS NULL`,
  },
  {
    version: 5,
    name: "oauth-tokens-revision-column",
    sql: `ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS revision BIGINT`,
  },
  {
    version: 6,
    name: "oauth-tokens-revision-backfill",
    sql: `UPDATE oauth_tokens SET revision = updated_at WHERE revision IS NULL`,
  },
];
