import { getDbExec, isPostgres, intType, type DbExec } from "../db/client.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS oauth_tokens (
          provider TEXT NOT NULL,
          account_id TEXT NOT NULL,
          owner TEXT,
          tokens TEXT NOT NULL,
          updated_at ${intType()} NOT NULL,
          PRIMARY KEY (provider, account_id)
        )
      `);
      // Migration: add owner column to existing tables
      try {
        await client.execute(`ALTER TABLE oauth_tokens ADD COLUMN owner TEXT`);
      } catch {
        // Column already exists
      }
      // Migration: add display_name column
      try {
        await client.execute(
          `ALTER TABLE oauth_tokens ADD COLUMN display_name TEXT`,
        );
      } catch {
        // Column already exists
      }
      // Backfill: set owner = account_id for existing rows without an owner
      await client.execute(
        `UPDATE oauth_tokens SET owner = account_id WHERE owner IS NULL`,
      );
    })();
  }
  return _initPromise;
}

export async function getOAuthTokens(
  provider: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT tokens FROM oauth_tokens WHERE provider = ? AND account_id = ?`,
    args: [provider, accountId],
  });
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].tokens as string);
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

  // Never store "local@localhost" as owner — it creates shared-ownership bugs
  const sanitizedOwner = owner === "local@localhost" ? accountId : owner;

  // Read the current row before deciding what to write. We use this to
  // (a) preserve owner / display_name when this is a token refresh (no
  // owner argument), and (b) reject the write when the caller is trying
  // to overwrite a row owned by someone else.
  let resolvedOwner = sanitizedOwner ?? accountId;
  let existingDisplayName: string | null = null;
  let existingOwner: string | null = null;
  const { rows: existing } = await client.execute({
    sql: `SELECT owner, display_name FROM oauth_tokens WHERE provider = ? AND account_id = ?`,
    args: [provider, accountId],
  });
  if (existing.length > 0) {
    existingOwner = (existing[0].owner as string) ?? null;
    existingDisplayName = (existing[0].display_name as string) ?? null;
  }

  if (!owner) {
    // Token-refresh path: keep the existing owner/displayName unchanged.
    if (existingOwner) resolvedOwner = existingOwner;
  } else if (
    existingOwner &&
    sanitizedOwner &&
    existingOwner !== sanitizedOwner
  ) {
    // Refuse to silently re-bind an account from one user to another.
    // This is the case the docstring promised but the previous
    // implementation didn't enforce — `ON CONFLICT DO UPDATE SET
    // owner=EXCLUDED.owner` would have overwritten the prior owner.
    throw new OAuthAccountOwnedByOtherUserError({
      provider,
      accountId,
      existingOwner,
      attemptedOwner: sanitizedOwner,
    });
  }

  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO oauth_tokens (provider, account_id, owner, display_name, tokens, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (provider, account_id) DO UPDATE SET owner=EXCLUDED.owner, display_name=COALESCE(EXCLUDED.display_name, oauth_tokens.display_name), tokens=EXCLUDED.tokens, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO oauth_tokens (provider, account_id, owner, display_name, tokens, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      provider,
      accountId,
      resolvedOwner,
      existingDisplayName,
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
  const client = getDbExec();
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

export async function listOAuthAccounts(provider: string): Promise<
  Array<{
    accountId: string;
    owner: string | null;
    tokens: Record<string, unknown>;
  }>
> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT account_id, owner, tokens FROM oauth_tokens WHERE provider = ?`,
    args: [provider],
  });
  return rows.map((row) => ({
    accountId: row.account_id as string,
    owner: (row.owner as string) ?? null,
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
): Promise<
  Array<{
    accountId: string;
    displayName: string | null;
    tokens: Record<string, unknown>;
  }>
> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT account_id, display_name, tokens FROM oauth_tokens WHERE provider = ? AND owner = ?`,
    args: [provider, owner],
  });
  return rows.map((row) => ({
    accountId: row.account_id as string,
    displayName: (row.display_name as string) ?? null,
    tokens: JSON.parse(row.tokens as string),
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
  await client.execute({
    sql: `UPDATE oauth_tokens SET display_name = ? WHERE provider = ? AND account_id = ?`,
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
 *
 * For the local-dev / single-tenant case, callers pass the dev sentinel
 * (`DEV_MODE_USER_EMAIL`) and we degrade to "any row exists" — preserving
 * the original behaviour for that single-user surface.
 */
export async function hasOAuthTokens(
  provider: string,
  owner: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  if (owner === "local@localhost") {
    const { rows } = await client.execute({
      sql: `SELECT 1 FROM oauth_tokens WHERE provider = ? LIMIT 1`,
      args: [provider],
    });
    return rows.length > 0;
  }
  const { rows } = await client.execute({
    sql: `SELECT 1 FROM oauth_tokens WHERE provider = ? AND owner = ? LIMIT 1`,
    args: [provider, owner],
  });
  return rows.length > 0;
}
