/**
 * Storage layer for the framework secrets registry.
 *
 * Values are encrypted at rest with AES-256-GCM. The encryption key is
 * derived from `SECRETS_ENCRYPTION_KEY` (preferred) or the existing
 * `BETTER_AUTH_SECRET` env var (fallback so templates don't need a second
 * secret during development). If neither is set in production we fall back
 * to a machine-local key derived from the cwd — the secret is still only
 * readable on this machine, but consider setting `SECRETS_ENCRYPTION_KEY`
 * for a stable, rotatable key.
 *
 * Secret values are NEVER logged and NEVER returned from any route handler.
 */

import { randomUUID } from "node:crypto";

import { getDbExec, isPostgres } from "../db/client.js";
import { ensureColumnExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  encryptSecretValue as encryptValue,
  decryptSecretValue as decryptValue,
} from "./crypto.js";
import type { SecretScope } from "./register.js";
import { APP_SECRETS_CREATE_SQL } from "./schema.js";

// ---------------------------------------------------------------------------
// Table bootstrap
// ---------------------------------------------------------------------------

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      // Postgres version of the CREATE TABLE — the generic `INTEGER` maps to
      // BIGINT on Postgres, which we need for millisecond timestamps.
      const createSql = isPostgres()
        ? APP_SECRETS_CREATE_SQL.replace(/\bINTEGER\b/g, "BIGINT")
        : APP_SECRETS_CREATE_SQL;

      if (isPostgres()) {
        // Hot path: in production the table and both additive columns are
        // virtually always already present. Issuing `CREATE`/`ALTER` would
        // still take an ACCESS EXCLUSIVE lock — which, in a fresh background
        // worker process behind a concurrent connection on the shared Neon DB,
        // can block ~indefinitely. `ensureTableExists` / `ensureColumnExists`
        // check `information_schema` first (a plain read, no lock) and run DDL
        // ONLY for what is actually missing, wrapping any DDL that must run in a
        // transaction-scoped `lock_timeout` so a contended lock fails fast. They
        // also re-probe after a swallowed lock-timeout and THROW if the schema
        // is still missing, so a timed-out DDL never poisons this init memo.
        await ensureTableExists("app_secrets", createSql);
        await ensureColumnExists(
          "app_secrets",
          "description",
          `ALTER TABLE app_secrets ADD COLUMN IF NOT EXISTS description TEXT`,
        );
        await ensureColumnExists(
          "app_secrets",
          "url_allowlist",
          `ALTER TABLE app_secrets ADD COLUMN IF NOT EXISTS url_allowlist TEXT`,
        );
        return;
      }

      // SQLite (local dev): no ACCESS EXCLUSIVE lock problem, keep the original
      // create-then-additive-alter behaviour. SQLite has no
      // `ADD COLUMN IF NOT EXISTS`, so the ALTERs stay wrapped in try/catch.
      await client.execute(createSql);

      // Additive migration: description column (for ad-hoc keys)
      try {
        await client.execute(
          `ALTER TABLE app_secrets ADD COLUMN description TEXT`,
        );
      } catch {
        // Column already exists — expected
      }

      // Additive migration: url_allowlist column
      try {
        await client.execute(
          `ALTER TABLE app_secrets ADD COLUMN url_allowlist TEXT`,
        );
      } catch {
        // Column already exists — expected
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

// ---------------------------------------------------------------------------
// Encryption — see ./crypto.ts (shared with per-user credentials)
// ---------------------------------------------------------------------------

/**
 * Return the last 4 characters of a secret, with any leading characters
 * masked. Used to show a preview without leaking the value.
 */
export function last4(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface SecretRef {
  key: string;
  scope: SecretScope;
  scopeId: string;
}

export interface WriteSecretArgs extends SecretRef {
  value: string;
  /** Optional human-readable description (used for ad-hoc keys). */
  description?: string;
  /** Optional JSON-stringified array of allowed URL origins. */
  urlAllowlist?: string;
}

/**
 * Write (insert or update) a secret. The value is encrypted before being
 * stored — the caller's plaintext is never persisted. Returns the new
 * record's id.
 */
export async function writeAppSecret(args: WriteSecretArgs): Promise<string> {
  await ensureTable();
  const { key, value, scope, scopeId, description, urlAllowlist } = args;
  if (!key || !value || !scope || !scopeId) {
    throw new Error(
      "writeAppSecret: key, value, scope, and scopeId are all required",
    );
  }
  const client = getDbExec();
  const now = Date.now();
  const encrypted = encryptValue(value);
  const id = randomUUID();

  // Atomic upsert by (scope, scope_id, key). Previously this was a
  // SELECT-then-branch (UPDATE if found, else INSERT): under concurrent
  // writers for the same key both could see "no row" and both attempt
  // INSERT, and the loser threw a raw UNIQUE(scope, scope_id, key)
  // constraint violation (a user-facing 500) instead of updating. A single
  // `INSERT ... ON CONFLICT DO UPDATE` closes that window — it's one
  // statement, so there's no gap between "check" and "act". `id` is
  // deliberately left out of the `DO UPDATE SET` list so an existing row
  // keeps its original id (any stored references stay stable); only a
  // genuinely new row gets the freshly generated `id`. This syntax is
  // portable across SQLite (UPSERT since 3.24) and Postgres.
  const upsertSql = `INSERT INTO app_secrets (id, scope, scope_id, key, encrypted_value, description, url_allowlist, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (scope, scope_id, key) DO UPDATE SET
      encrypted_value = excluded.encrypted_value,
      description = excluded.description,
      url_allowlist = excluded.url_allowlist,
      updated_at = excluded.updated_at`;
  const upsertArgs = [
    id,
    scope,
    scopeId,
    key,
    encrypted,
    description ?? null,
    urlAllowlist ?? null,
    now,
    now,
  ];

  if (isPostgres()) {
    const { rows } = await client.execute({
      sql: `${upsertSql} RETURNING id`,
      args: upsertArgs,
    });
    return String(rows[0]?.id ?? id);
  }

  // SQLite: RETURNING support varies across better-sqlite3/libsql builds, so
  // (matching the convention elsewhere in this codebase, e.g.
  // integrations/pending-tasks-store.ts) re-read the id afterward instead of
  // relying on it. The row is guaranteed to exist at this point, so this is
  // a plain lookup rather than a TOCTOU-prone gate on the write itself.
  await client.execute({ sql: upsertSql, args: upsertArgs });
  const { rows } = await client.execute({
    sql: `SELECT id FROM app_secrets WHERE scope = ? AND scope_id = ? AND key = ? LIMIT 1`,
    args: [scope, scopeId, key],
  });
  return String(rows[0]?.id ?? id);
}

export interface ReadSecretResult {
  value: string;
  last4: string;
  updatedAt: number;
}

type AppSecretsReadQuery = { sql: string; args: unknown[] };

/**
 * True only when the database says the app_secrets table itself is missing.
 * Other query failures must propagate unchanged: attempting schema bootstrap
 * for connectivity, permission, or syntax errors both hides the real failure
 * and can introduce DDL onto a latency-sensitive read path.
 */
function isMissingAppSecretsTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = String((error as Error & { code?: unknown }).code ?? "");
  const message = error.message.toLowerCase();
  const namesAppSecrets = /(?:app_secrets|"app_secrets")/.test(message);

  if (code === "42P01") return namesAppSecrets;
  return (
    namesAppSecrets &&
    (message.includes("no such table") ||
      (message.includes("relation") && message.includes("does not exist")))
  );
}

/** Execute a read without schema probes on the normal path. */
async function executeAppSecretsRead(query: AppSecretsReadQuery) {
  const client = getDbExec();
  try {
    return await client.execute(query);
  } catch (error) {
    if (!isMissingAppSecretsTableError(error)) throw error;
    await ensureTable();
    return client.execute(query);
  }
}

/**
 * Read a secret's plaintext value. Returns null when not found. The caller
 * is responsible for never logging the returned value.
 */
export async function readAppSecret(
  ref: SecretRef,
): Promise<ReadSecretResult | null> {
  const { key, scope, scopeId } = ref;
  const { rows } = await executeAppSecretsRead({
    sql: `SELECT encrypted_value, updated_at FROM app_secrets WHERE scope = ? AND scope_id = ? AND key = ? LIMIT 1`,
    args: [scope, scopeId, key],
  });
  if (rows.length === 0) return null;
  try {
    const value = decryptValue(rows[0].encrypted_value as string);
    return {
      value,
      last4: last4(value),
      updatedAt: Number(rows[0].updated_at ?? 0),
    };
  } catch {
    // Decryption failure — key rotated, tampered row, etc. Don't throw up the
    // stack in a way that could leak the ciphertext; just report missing.
    return null;
  }
}

/** Read several keys from one scope in a single database round trip. */
export async function readAppSecrets(args: {
  keys: readonly string[];
  scope: SecretScope;
  scopeId: string;
}): Promise<Map<string, ReadSecretResult>> {
  const keys = [...new Set(args.keys.filter(Boolean))];
  if (keys.length === 0) return new Map();

  const placeholders = keys.map(() => "?").join(", ");
  const { rows } = await executeAppSecretsRead({
    sql: `SELECT key, encrypted_value, updated_at FROM app_secrets WHERE scope = ? AND scope_id = ? AND key IN (${placeholders})`,
    args: [args.scope, args.scopeId, ...keys],
  });
  const results = new Map<string, ReadSecretResult>();
  for (const row of rows) {
    const key = String(row.key ?? "");
    if (!key) continue;
    try {
      const value = decryptValue(row.encrypted_value as string);
      results.set(key, {
        value,
        last4: last4(value),
        updatedAt: Number(row.updated_at ?? 0),
      });
    } catch {
      // Match readAppSecret: corrupted or stale ciphertext behaves as missing.
    }
  }
  return results;
}

/**
 * Return just the metadata for a secret (no value). Used by the list route so
 * the UI can show the "Set" pill and last-4 without the decrypted value going
 * over the wire.
 */
export async function getAppSecretMeta(
  ref: SecretRef,
): Promise<{ last4: string; updatedAt: number } | null> {
  const result = await readAppSecret(ref);
  if (!result) return null;
  return { last4: result.last4, updatedAt: result.updatedAt };
}

export interface SecretMeta {
  key: string;
  scope: SecretScope;
  scopeId: string;
  last4: string;
  description: string | null;
  urlAllowlist: string[] | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Read a secret's metadata, including ad-hoc fields (description, allowlist),
 * without ever decrypting or returning the plaintext value. Used by the
 * ad-hoc list route and any UI that wants to render a key tile.
 */
export async function readAppSecretMeta(
  ref: SecretRef,
): Promise<SecretMeta | null> {
  await ensureTable();
  const { key, scope, scopeId } = ref;
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT encrypted_value, description, url_allowlist, created_at, updated_at FROM app_secrets WHERE scope = ? AND scope_id = ? AND key = ? LIMIT 1`,
    args: [scope, scopeId, key],
  });
  if (rows.length === 0) return null;
  const row = rows[0];
  let last4Value = "";
  try {
    const value = decryptValue(row.encrypted_value as string);
    last4Value = last4(value);
  } catch {
    last4Value = "";
  }
  return {
    key,
    scope,
    scopeId,
    last4: last4Value,
    description: (row.description as string | null) ?? null,
    urlAllowlist: parseAllowlist(row.url_allowlist as string | null),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

/**
 * List all secrets for a given scope. Returns metadata only — values are
 * never decrypted or returned. Used by the ad-hoc list route to surface
 * user-created keys.
 */
export async function listAppSecretsForScope(
  scope: SecretScope,
  scopeId: string,
): Promise<SecretMeta[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT key, encrypted_value, description, url_allowlist, created_at, updated_at FROM app_secrets WHERE scope = ? AND scope_id = ? ORDER BY updated_at DESC`,
    args: [scope, scopeId],
  });
  return rows.map((row) => {
    let last4Value = "";
    try {
      const value = decryptValue(row.encrypted_value as string);
      last4Value = last4(value);
    } catch {
      last4Value = "";
    }
    return {
      key: row.key as string,
      scope,
      scopeId,
      last4: last4Value,
      description: (row.description as string | null) ?? null,
      urlAllowlist: parseAllowlist(row.url_allowlist as string | null),
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    };
  });
}

function parseAllowlist(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function deleteAppSecret(ref: SecretRef): Promise<boolean> {
  await ensureTable();
  const { key, scope, scopeId } = ref;
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `DELETE FROM app_secrets WHERE scope = ? AND scope_id = ? AND key = ?`,
    args: [scope, scopeId, key],
  });
  return rowsAffected > 0;
}
