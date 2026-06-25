/**
 * Core script: db-migrate-encrypt-credentials
 *
 * One-shot, in-place migration: encrypt any plaintext per-user / per-org
 * credential rows in the `settings` table (`u:<email>:credential:<KEY>` and
 * `o:<orgId>:credential:<KEY>`) with the same AES-256-GCM scheme the secrets
 * vault uses.
 *
 * Background. `resolveCredential` / `saveCredential` historically stored
 * third-party API keys as plaintext JSON in `settings`. Writes are now
 * encrypted at rest, and reads transparently fall back to plaintext, so this
 * migration is OPTIONAL — it re-encrypts existing rows so a leaked DB
 * backup / pg_dump / read replica no longer exposes plaintext keys.
 *
 * Non-destructive: it only rewrites the `value` of credential rows in place
 * (no row is dropped). Idempotent: already-encrypted rows are skipped.
 *
 * IMPORTANT: run with the SAME SECRETS_ENCRYPTION_KEY / BETTER_AUTH_SECRET the
 * app uses, or the app won't be able to decrypt the result. The script refuses
 * to run without an explicit key.
 *
 * Usage:
 *   DATABASE_URL=postgres://... SECRETS_ENCRYPTION_KEY=... pnpm action db-migrate-encrypt-credentials
 *   pnpm action db-migrate-encrypt-credentials --db ./data/app.db
 *   pnpm action db-migrate-encrypt-credentials --dry-run
 */

import path from "path";

import { createClient } from "@libsql/client";

import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import {
  encryptSecretValue,
  isEncryptedSecretValue,
} from "../../secrets/crypto.js";
import { parseArgs } from "../utils.js";

interface CredentialRow {
  settingsKey: string;
  plaintext: string;
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

const CREDENTIAL_LIKE = "%:credential:%";

/** Extract the stored credential string from a settings JSON value. */
function extractValue(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.value === "string" && parsed.value.length > 0) {
      return parsed.value;
    }
    return null;
  } catch {
    return null;
  }
}

function mask(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)} (len=${value.length})`;
}

export default async function dbMigrateEncryptCredentials(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-migrate-encrypt-credentials [options]

Encrypts plaintext credential rows (u:<email>:credential:* and
o:<orgId>:credential:*) in the settings table, in place. Idempotent and
non-destructive (skips already-encrypted rows; never deletes a row).

Run with the same SECRETS_ENCRYPTION_KEY / BETTER_AUTH_SECRET the app uses.

Options:
  --db <path>   Path to SQLite database (default: data/app.db)
  --dry-run     Print what would be encrypted without writing
  --help        Show this help message`);
    return;
  }

  if (!process.env.SECRETS_ENCRYPTION_KEY && !process.env.BETTER_AUTH_SECRET) {
    console.error(
      "[migrate-encrypt-credentials] Refusing to run without SECRETS_ENCRYPTION_KEY or BETTER_AUTH_SECRET set. " +
        "Encrypting with the machine-local fallback would produce values the app cannot decrypt.",
    );
    throw new Error("Missing encryption key");
  }

  const dryRun = parsed["dry-run"] === "true";

  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  const dbLabel = url.startsWith("file:")
    ? url.slice("file:".length)
    : new URL(url).host || url;
  console.log(
    `[migrate-encrypt-credentials] target: ${dbLabel}${dryRun ? "  (dry-run)" : ""}`,
  );

  const rows = await fetchPlaintextCredentialRows(url);
  if (rows.length === 0) {
    console.log("[migrate-encrypt-credentials] nothing to encrypt.");
    return;
  }

  console.log(
    `[migrate-encrypt-credentials] found ${rows.length} plaintext credential row(s):`,
  );
  for (const row of rows) {
    console.log(`  - ${row.settingsKey}  ${mask(row.plaintext)}`);
  }
  if (dryRun) return;

  let encrypted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const newValue = JSON.stringify({
        value: encryptSecretValue(row.plaintext),
      });
      await updateRow(url, row.settingsKey, newValue);
      encrypted++;
    } catch (err) {
      console.error(
        `  ! failed to encrypt ${row.settingsKey}:`,
        err instanceof Error ? err.message : err,
      );
      failed++;
    }
  }
  console.log(
    `[migrate-encrypt-credentials] done. encrypted=${encrypted} failed=${failed}`,
  );
}

async function fetchPlaintextCredentialRows(
  url: string,
): Promise<CredentialRow[]> {
  const out: CredentialRow[] = [];
  const collect = (key: string, value: string) => {
    if (!key.includes(":credential:")) return;
    const plaintext = extractValue(value);
    if (plaintext === null) return;
    // Already encrypted → leave it (idempotent).
    if (isEncryptedSecretValue(plaintext)) return;
    out.push({ settingsKey: key, plaintext });
  };

  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const sql = pg(url);
    try {
      const rows = (await sql.unsafe(
        `SELECT key, value FROM settings WHERE key LIKE $1`,
        [CREDENTIAL_LIKE],
      )) as unknown as Array<{ key: string; value: string }>;
      for (const row of rows) collect(row.key, row.value);
    } finally {
      await sql.end();
    }
    return out;
  }

  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  try {
    const result = await client.execute({
      sql: `SELECT key, value FROM settings WHERE key LIKE ?`,
      args: [CREDENTIAL_LIKE],
    });
    for (const row of result.rows) {
      collect(row.key as string, row.value as string);
    }
  } finally {
    client.close();
  }
  return out;
}

async function updateRow(
  url: string,
  key: string,
  value: string,
): Promise<void> {
  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const sql = pg(url);
    try {
      await sql.unsafe(`UPDATE settings SET value = $1 WHERE key = $2`, [
        value,
        key,
      ]);
    } finally {
      await sql.end();
    }
    return;
  }
  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  try {
    await client.execute({
      sql: `UPDATE settings SET value = ? WHERE key = ?`,
      args: [value, key],
    });
  } finally {
    client.close();
  }
}
