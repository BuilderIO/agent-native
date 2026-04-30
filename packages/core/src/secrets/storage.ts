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

import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { getDbExec, isPostgres } from "../db/client.js";
import { APP_SECRETS_CREATE_SQL } from "./schema.js";
import type { SecretScope } from "./register.js";

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
      const sql = isPostgres()
        ? APP_SECRETS_CREATE_SQL.replace(/\bINTEGER\b/g, "BIGINT")
        : APP_SECRETS_CREATE_SQL;
      await client.execute(sql);

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
    })();
  }
  return _initPromise;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte AES key from the configured secret material via SHA-256.
 * Re-derived per-request (cheap, stateless, and makes rotation easy).
 *
 * In production we refuse to start with the CWD-derived fallback. Same
 * posture `resolveAuthSecret` takes for `BETTER_AUTH_SECRET` — fail loud
 * rather than encrypt every secret with a key that's effectively static
 * across the whole deployment (Lambda CWD is `/var/task`, etc.). Anyone
 * with read access to the DB (forgotten backup, pg_dump, downgraded env)
 * could otherwise decrypt every user's secrets with trivial work.
 */
function getEncryptionKey(): Buffer {
  const explicit =
    process.env.SECRETS_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;

  if (!explicit) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[agent-native/secrets] Refusing to start in production without an encryption key. " +
          "Set SECRETS_ENCRYPTION_KEY (preferred) or BETTER_AUTH_SECRET in the deploy environment. " +
          "The previous CWD-derived fallback was effectively static (e.g. `/var/task` on Lambda), " +
          "which means anyone with read access to the secrets table could decrypt every user's secrets.",
      );
    }
    if (!_warnedFallback) {
      _warnedFallback = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[agent-native/secrets] SECRETS_ENCRYPTION_KEY not set — using a machine-local fallback. " +
          "Set SECRETS_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) for production. " +
          "Production deploys without one of these env vars now hard-fail.",
      );
    }
  }

  const material = explicit || `agent-native-secrets:${process.cwd()}`;
  return createHash("sha256").update(material).digest();
}

let _warnedFallback = false;

/** Encrypt a plain-text value. Returns `v1:<iv-hex>:<ct-hex>:<tag-hex>`. */
function encryptValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a value produced by `encryptValue`. Throws on tampering. */
function decryptValue(encrypted: string): string {
  if (!encrypted.startsWith("v1:")) {
    throw new Error("Unrecognised secret encoding");
  }
  const [, ivHex, ctHex, tagHex] = encrypted.split(":");
  if (!ivHex || !ctHex || !tagHex) {
    throw new Error("Corrupt secret payload");
  }
  const key = getEncryptionKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

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

  // Upsert by (scope, scope_id, key). Keep the existing row's id on update so
  // references stay stable.
  const { rows } = await client.execute({
    sql: `SELECT id FROM app_secrets WHERE scope = ? AND scope_id = ? AND key = ?`,
    args: [scope, scopeId, key],
  });
  if (rows.length > 0) {
    const id = rows[0].id as string;
    await client.execute({
      sql: `UPDATE app_secrets SET encrypted_value = ?, description = ?, url_allowlist = ?, updated_at = ? WHERE id = ?`,
      args: [encrypted, description ?? null, urlAllowlist ?? null, now, id],
    });
    return id;
  }
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO app_secrets (id, scope, scope_id, key, encrypted_value, description, url_allowlist, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      scope,
      scopeId,
      key,
      encrypted,
      description ?? null,
      urlAllowlist ?? null,
      now,
      now,
    ],
  });
  return id;
}

export interface ReadSecretResult {
  value: string;
  last4: string;
  updatedAt: number;
}

/**
 * Read a secret's plaintext value. Returns null when not found. The caller
 * is responsible for never logging the returned value.
 */
export async function readAppSecret(
  ref: SecretRef,
): Promise<ReadSecretResult | null> {
  await ensureTable();
  const { key, scope, scopeId } = ref;
  const client = getDbExec();
  const { rows } = await client.execute({
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
