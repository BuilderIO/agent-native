import { getDbExec, isPostgres, intType } from "../db/client.js";
import { ensureColumnExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import {
  encryptSecretValue,
  decryptSecretValue,
  isEncryptedSecretValue,
} from "../secrets/crypto.js";

let _initPromise: Promise<void> | undefined;

/**
 * Encrypt the token bundle (AES-256-GCM) before it goes to the `tokens`
 * column. OAuth access/refresh tokens are long-lived, high-value credentials;
 * encrypting at rest means a leaked DB backup / pg_dump / read replica no
 * longer exposes them in plaintext. {@link parseStoredTokens} decrypts
 * transparently on read.
 */
function serializeTokens(tokens: Record<string, unknown>): string {
  return encryptSecretValue(JSON.stringify(tokens));
}

/**
 * Parse a stored `tokens` value. Encrypted rows are decrypted; rows written
 * before encryption — or mirrored from Better Auth's `account` table — are
 * plaintext JSON and read transparently (the `db-migrate-encrypt-oauth-tokens`
 * script re-encrypts them in place). A row that can't be decrypted (key
 * rotated / corrupt / tampered) is treated as empty rather than throwing into
 * every token lookup.
 */
function parseStoredTokens(
  stored: string | null | undefined,
): Record<string, unknown> {
  if (!stored) return {};
  if (isEncryptedSecretValue(stored)) {
    try {
      return JSON.parse(decryptSecretValue(stored));
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

function oauthTokensTable(): string {
  return isPostgres() ? "public.oauth_tokens" : "oauth_tokens";
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const table = oauthTokensTable();
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${table} (
          provider TEXT NOT NULL,
          account_id TEXT NOT NULL,
          owner TEXT,
          tokens TEXT NOT NULL,
          updated_at ${intType()} NOT NULL,
          PRIMARY KEY (provider, account_id)
        )
      `;

      if (isPostgres()) {
        // Hot path: the `oauth_tokens` table and its additive columns are
        // virtually always already present in production. Issuing `CREATE
        // TABLE`/`ALTER TABLE` still takes an ACCESS EXCLUSIVE lock that, in a
        // fresh background-worker process behind a concurrent connection on the
        // shared Neon DB, can block ~indefinitely. The ensure* wrappers probe
        // `information_schema` first (plain reads, no lock) and run DDL ONLY for
        // what is actually missing, bounded by a transaction-scoped
        // `lock_timeout`. If a swallowed lock-timeout leaves the schema still
        // missing they RE-PROBE and THROW rather than letting init memoize
        // success against absent schema. `oauthTokensTable()` is
        // `public.oauth_tokens` on Postgres; the wrappers take the unqualified
        // table name.
        await ensureTableExists("oauth_tokens", createSql);
        // Migration: add owner column to existing tables — guarded so the hot
        // path (column already present) skips the ACCESS EXCLUSIVE ALTER.
        await ensureColumnExists(
          "oauth_tokens",
          "owner",
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS owner TEXT`,
        );
        // Migration: add display_name column
        await ensureColumnExists(
          "oauth_tokens",
          "display_name",
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS display_name TEXT`,
        );
        // Backfill: set owner = account_id for existing rows without an owner
        await client.execute(
          `UPDATE ${table} SET owner = account_id WHERE owner IS NULL`,
        );
        // Older deployments have a 32-bit `updated_at`; on Postgres the
        // `Date.now()` written on every token save overflows int4. Widen in place
        // (no-op once done / on fresh DBs). Unqualified name — the helper scopes
        // to the `public` schema.
        await widenIntColumnsToBigInt("oauth_tokens", ["updated_at"]);
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      // Migration: add owner column to existing tables
      try {
        await client.execute(`ALTER TABLE ${table} ADD COLUMN owner TEXT`);
      } catch {
        // Column already exists
      }
      // Migration: add display_name column
      try {
        await client.execute(
          `ALTER TABLE ${table} ADD COLUMN display_name TEXT`,
        );
      } catch {
        // Column already exists
      }
      // Backfill: set owner = account_id for existing rows without an owner
      await client.execute(
        `UPDATE ${table} SET owner = account_id WHERE owner IS NULL`,
      );
      // Older deployments have a 32-bit `updated_at`; on Postgres the
      // `Date.now()` written on every token save overflows int4. Widen in place
      // (no-op once done / on fresh DBs). Unqualified name — the helper scopes
      // to the `public` schema.
      await widenIntColumnsToBigInt("oauth_tokens", ["updated_at"]);
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function getOAuthTokens(
  provider: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();
  const { rows } = await client.execute({
    sql: `SELECT tokens FROM ${table} WHERE provider = ? AND account_id = ?`,
    args: [provider, accountId],
  });
  if (rows.length === 0) return null;
  return parseStoredTokens(rows[0].tokens as string);
}

/**
 * Thrown when an OAuth save would re-bind an `(provider, account_id)` row
 * to a different owner than already holds it. Callers should catch this and
 * surface a clean "this account is already linked to another user" message
 * to the requester rather than letting it propagate as a 500.
 *
 * Carries `statusCode = 409` so route handlers using h3's `createError` can
 * pass it straight through.
 */
export class OAuthAccountOwnedByOtherUserError extends Error {
  readonly statusCode = 409;
  readonly provider: string;
  readonly accountId: string;
  readonly existingOwner: string;
  readonly attemptedOwner: string;
  constructor(opts: {
    provider: string;
    accountId: string;
    existingOwner: string;
    attemptedOwner: string;
  }) {
    super(
      `OAuth account ${opts.provider}:${opts.accountId} is already linked to another user — refusing to overwrite the owner.`,
    );
    this.name = "OAuthAccountOwnedByOtherUserError";
    this.provider = opts.provider;
    this.accountId = opts.accountId;
    this.existingOwner = opts.existingOwner;
    this.attemptedOwner = opts.attemptedOwner;
  }
}

/**
 * Save OAuth tokens. The `owner` parameter specifies which user owns this
 * account — defaults to `accountId` (the account itself is the owner).
 * For multi-account support, pass the logged-in user's email as owner.
 *
 * If the account already exists and is owned by a different user, throws
 * `OAuthAccountOwnedByOtherUserError` (statusCode 409) to prevent silently
 * stealing another user's linked account.
 *
 * Read + write happen as a single linearised batch (Postgres) or paired
 * statements (SQLite). On both backends the per-row PK serialises concurrent
 * writes for the same `(provider, account_id)` so the owner check cannot be
 * raced by an attacker calling saveOAuthTokens twice in flight — the second
 * caller sees the first caller's owner row and raises 409.
 */
export async function saveOAuthTokens(
  provider: string,
  accountId: string,
  tokens: Record<string, unknown>,
  owner?: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();

  // Read the current row before deciding what to write. We use this to
  // (a) preserve owner / display_name when this is a token refresh (no
  // owner argument), and (b) reject the write when the caller is trying
  // to overwrite a row owned by someone else.
  let resolvedOwner = owner ?? accountId;
  let existingDisplayName: string | null = null;
  let existingOwner: string | null = null;
  let existingTokens: Record<string, unknown> | null = null;
  const { rows: existing } = await client.execute({
    sql: `SELECT owner, display_name, tokens FROM ${table} WHERE provider = ? AND account_id = ?`,
    args: [provider, accountId],
  });
  if (existing.length > 0) {
    existingOwner = (existing[0].owner as string) ?? null;
    existingDisplayName = (existing[0].display_name as string) ?? null;
    existingTokens = parseStoredTokens(existing[0].tokens as string);
  }

  if (!owner) {
    // Token-refresh path: keep the existing owner/displayName unchanged.
    if (existingOwner) resolvedOwner = existingOwner;
  } else if (existingOwner && owner && existingOwner !== owner) {
    // Refuse to silently re-bind an account from one user to another.
    // This is the case the docstring promised but the previous
    // implementation didn't enforce — `ON CONFLICT DO UPDATE SET
    // owner=EXCLUDED.owner` would have overwritten the prior owner.
    throw new OAuthAccountOwnedByOtherUserError({
      provider,
      accountId,
      existingOwner,
      attemptedOwner: owner,
    });
  }

  const cleanedIncomingTokens = Object.fromEntries(
    Object.entries(tokens).filter(([, value]) => value !== undefined),
  );
  const tokensToStore = {
    ...(existingTokens ?? {}),
    ...cleanedIncomingTokens,
  };

  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO ${table} (provider, account_id, owner, display_name, tokens, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (provider, account_id) DO UPDATE SET owner=EXCLUDED.owner, display_name=COALESCE(EXCLUDED.display_name, ${table}.display_name), tokens=EXCLUDED.tokens, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO ${table} (provider, account_id, owner, display_name, tokens, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      provider,
      accountId,
      resolvedOwner,
      existingDisplayName,
      serializeTokens(tokensToStore),
      Date.now(),
    ],
  });
}

export async function deleteOAuthTokens(
  provider: string,
  accountId?: string,
): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();
  if (accountId) {
    const result = await client.execute({
      sql: `DELETE FROM ${table} WHERE provider = ? AND account_id = ?`,
      args: [provider, accountId],
    });
    return result.rowsAffected;
  }
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE provider = ?`,
    args: [provider],
  });
  return result.rowsAffected;
}

export async function listOAuthAccounts(provider: string): Promise<
  Array<{
    accountId: string;
    owner: string | null;
    tokens: Record<string, unknown>;
  }>
> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();
  const { rows } = await client.execute({
    sql: `SELECT account_id, owner, tokens FROM ${table} WHERE provider = ?`,
    args: [provider],
  });
  return rows.map((row) => ({
    accountId: row.account_id as string,
    owner: (row.owner as string) ?? null,
    tokens: parseStoredTokens(row.tokens as string),
  }));
}

/**
 * List all OAuth accounts owned by a specific user.
 * In multi-account mode, a user may have connected multiple Google accounts.
 */
export async function listOAuthAccountsByOwner(
  provider: string,
  owner: string,
): Promise<
  Array<{
    accountId: string;
    displayName: string | null;
    tokens: Record<string, unknown>;
  }>
> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();
  const { rows } = await client.execute({
    sql: `SELECT account_id, display_name, tokens FROM ${table} WHERE provider = ? AND owner = ?`,
    args: [provider, owner],
  });
  return rows.map((row) => ({
    accountId: row.account_id as string,
    displayName: (row.display_name as string) ?? null,
    tokens: parseStoredTokens(row.tokens as string),
  }));
}

/**
 * Set the display name for an OAuth account (e.g. Google profile name).
 */
export async function setOAuthDisplayName(
  provider: string,
  accountId: string,
  displayName: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();
  await client.execute({
    sql: `UPDATE ${table} SET display_name = ? WHERE provider = ? AND account_id = ?`,
    args: [displayName, provider, accountId],
  });
}

/**
 * Check whether a specific user has tokens for a provider.
 *
 * `owner` is REQUIRED. The previous unscoped form leaked information
 * across users — the onboarding banner would mark the OAuth secret as
 * "set" for user B as soon as ANY user in the deployment connected the
 * provider, and user B would never see the prompt to connect.
 */
export async function hasOAuthTokens(
  provider: string,
  owner: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const table = oauthTokensTable();
  const { rows } = await client.execute({
    sql: `SELECT 1 FROM ${table} WHERE provider = ? AND owner = ? LIMIT 1`,
    args: [provider, owner],
  });
  return rows.length > 0;
}
