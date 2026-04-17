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
 */
function getEncryptionKey(): Buffer {
  const material =
    process.env.SECRETS_ENCRYPTION_KEY ||
    process.env.BETTER_AUTH_SECRET ||
    // Machine-local fallback — a stable string tied to the project on disk.
    // Not ideal for shared/hosted databases; warn once below.
    `agent-native-secrets:${process.cwd()}`;

  if (
    !process.env.SECRETS_ENCRYPTION_KEY &&
    !process.env.BETTER_AUTH_SECRET &&
    !_warnedFallback
  ) {
    _warnedFallback = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[agent-native/secrets] SECRETS_ENCRYPTION_KEY not set — using a machine-local fallback. " +
        "Set SECRETS_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) for production.",
    );
  }

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
}

/**
 * Write (insert or update) a secret. The value is encrypted before being
 * stored — the caller's plaintext is never persisted. Returns the new
 * record's id.
 */
export async function writeAppSecret(args: WriteSecretArgs): Promise<string> {
  await ensureTable();
  const { key, value, scope, scopeId } = args;
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
      sql: `UPDATE app_secrets SET encrypted_value = ?, updated_at = ? WHERE id = ?`,
      args: [encrypted, now, id],
    });
    return id;
  }
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO app_secrets (id, scope, scope_id, key, encrypted_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, scope, scopeId, key, encrypted, now, now],
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
