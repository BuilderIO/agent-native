import { createClient, type Client } from "@libsql/client";
import fs from "fs";
import path from "path";

let _client: Client | undefined;
let _initialized = false;

function getClient(): Client {
  if (!_client) {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    if (url.startsWith("file:")) {
      fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
    }
    _client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return _client;
}

async function ensureTable(): Promise<void> {
  if (_initialized) return;
  const client = getClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      owner TEXT,
      tokens TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, account_id)
    )
  `);
  // Migration: add owner column to existing tables
  try {
    await client.execute(`ALTER TABLE oauth_tokens ADD COLUMN owner TEXT`);
  } catch {
    // Column already exists
  }
  // Backfill: set owner = account_id for existing rows without an owner
  await client.execute(
    `UPDATE oauth_tokens SET owner = account_id WHERE owner IS NULL`,
  );
  _initialized = true;
}

export async function getOAuthTokens(
  provider: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT tokens FROM oauth_tokens WHERE provider = ? AND account_id = ?`,
    args: [provider, accountId],
  });
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].tokens as string);
}

/**
 * Save OAuth tokens. The `owner` parameter specifies which user owns this
 * account — defaults to `accountId` (the account itself is the owner).
 * For multi-account support, pass the logged-in user's email as owner.
 *
 * If the account already exists and is owned by a different user, throws
 * an error to prevent silently stealing another user's linked account.
 */
export async function saveOAuthTokens(
  provider: string,
  accountId: string,
  tokens: Record<string, unknown>,
  owner?: string,
): Promise<void> {
  await ensureTable();
  const client = getClient();
  const resolvedOwner = owner ?? accountId;

  // Check if this account is already owned by a different user
  const { rows: existing } = await client.execute({
    sql: `SELECT owner FROM oauth_tokens WHERE provider = ? AND account_id = ?`,
    args: [provider, accountId],
  });
  if (
    existing.length > 0 &&
    existing[0].owner &&
    existing[0].owner !== resolvedOwner
  ) {
    throw new Error(`This Google account is already linked to another user.`);
  }

  await client.execute({
    sql: `INSERT OR REPLACE INTO oauth_tokens (provider, account_id, owner, tokens, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [
      provider,
      accountId,
      resolvedOwner,
      JSON.stringify(tokens),
      Date.now(),
    ],
  });
}

export async function deleteOAuthTokens(
  provider: string,
  accountId?: string,
): Promise<number> {
  await ensureTable();
  const client = getClient();
  if (accountId) {
    const result = await client.execute({
      sql: `DELETE FROM oauth_tokens WHERE provider = ? AND account_id = ?`,
      args: [provider, accountId],
    });
    return result.rowsAffected;
  }
  const result = await client.execute({
    sql: `DELETE FROM oauth_tokens WHERE provider = ?`,
    args: [provider],
  });
  return result.rowsAffected;
}

export async function listOAuthAccounts(
  provider: string,
): Promise<Array<{ accountId: string; tokens: Record<string, unknown> }>> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT account_id, tokens FROM oauth_tokens WHERE provider = ?`,
    args: [provider],
  });
  return rows.map((row) => ({
    accountId: row.account_id as string,
    tokens: JSON.parse(row.tokens as string),
  }));
}

/**
 * List all OAuth accounts owned by a specific user.
 * In multi-account mode, a user may have connected multiple Google accounts.
 */
export async function listOAuthAccountsByOwner(
  provider: string,
  owner: string,
): Promise<Array<{ accountId: string; tokens: Record<string, unknown> }>> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT account_id, tokens FROM oauth_tokens WHERE provider = ? AND owner = ?`,
    args: [provider, owner],
  });
  return rows.map((row) => ({
    accountId: row.account_id as string,
    tokens: JSON.parse(row.tokens as string),
  }));
}

export async function hasOAuthTokens(provider: string): Promise<boolean> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT 1 FROM oauth_tokens WHERE provider = ? LIMIT 1`,
    args: [provider],
  });
  return rows.length > 0;
}
