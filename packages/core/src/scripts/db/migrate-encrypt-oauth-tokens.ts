/**
 * Core script: db-migrate-encrypt-oauth-tokens
 *
 * One-shot, in-place migration: encrypt any plaintext `tokens` payloads in the
 * `oauth_tokens` table with the same AES-256-GCM scheme the secrets vault and
 * per-user credentials use.
 *
 * Background. `oauth_tokens` historically stored the full OAuth bundle —
 * including long-lived Google refresh tokens — as plaintext JSON. Writes are
 * now encrypted at rest, and reads transparently fall back to plaintext, so
 * this migration is OPTIONAL: it re-encrypts existing rows so a leaked DB
 * backup / pg_dump / read replica no longer exposes usable refresh/access
 * tokens.
 *
 * Non-destructive: it only rewrites the `tokens` value of each row in place
 * (no row is dropped). Idempotent: already-encrypted rows are skipped.
 *
 * IMPORTANT: run with the SAME SECRETS_ENCRYPTION_KEY / BETTER_AUTH_SECRET the
 * app uses, or the app won't be able to decrypt the result. The script refuses
 * to run without an explicit key.
 *
 * Usage:
 *   DATABASE_URL=postgres://... SECRETS_ENCRYPTION_KEY=... pnpm action db-migrate-encrypt-oauth-tokens
 *   pnpm action db-migrate-encrypt-oauth-tokens --db ./data/app.db
 *   pnpm action db-migrate-encrypt-oauth-tokens --dry-run
 */

import path from "path";

import { createClient } from "@libsql/client";

import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import {
  encryptSecretValue,
  isEncryptedSecretValue,
} from "../../secrets/crypto.js";
import { parseArgs } from "../utils.js";

interface OAuthTokenRow {
  provider: string;
  accountId: string;
  plaintext: string;
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function mask(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)} (len=${value.length})`;
}

export default async function dbMigrateEncryptOAuthTokens(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-migrate-encrypt-oauth-tokens [options]

Encrypts plaintext token payloads in the oauth_tokens table, in place.
Idempotent and non-destructive (skips already-encrypted rows; never deletes a
row).

Run with the same SECRETS_ENCRYPTION_KEY / BETTER_AUTH_SECRET the app uses.

Options:
  --db <path>   Path to SQLite database (default: data/app.db)
  --dry-run     Print what would be encrypted without writing
  --help        Show this help message`);
    return;
  }

  if (!process.env.SECRETS_ENCRYPTION_KEY && !process.env.BETTER_AUTH_SECRET) {
    console.error(
      "[migrate-encrypt-oauth-tokens] Refusing to run without SECRETS_ENCRYPTION_KEY or BETTER_AUTH_SECRET set. " +
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
    `[migrate-encrypt-oauth-tokens] target: ${dbLabel}${dryRun ? "  (dry-run)" : ""}`,
  );

  const rows = await fetchPlaintextTokenRows(url);
  if (rows.length === 0) {
    console.log("[migrate-encrypt-oauth-tokens] nothing to encrypt.");
    return;
  }

  console.log(
    `[migrate-encrypt-oauth-tokens] found ${rows.length} plaintext token row(s):`,
  );
  for (const row of rows) {
    console.log(`  - ${row.provider}:${row.accountId}  ${mask(row.plaintext)}`);
  }
  if (dryRun) return;

  let encrypted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await updateRow(
        url,
        row.provider,
        row.accountId,
        encryptSecretValue(row.plaintext),
      );
      encrypted++;
    } catch (err) {
      console.error(
        `  ! failed to encrypt ${row.provider}:${row.accountId}:`,
        err instanceof Error ? err.message : err,
      );
      failed++;
    }
  }
  console.log(
    `[migrate-encrypt-oauth-tokens] done. encrypted=${encrypted} failed=${failed}`,
  );
}

async function fetchPlaintextTokenRows(url: string): Promise<OAuthTokenRow[]> {
  const out: OAuthTokenRow[] = [];
  const collect = (provider: string, accountId: string, tokens: string) => {
    if (typeof tokens !== "string" || tokens.length === 0) return;
    // Already encrypted → leave it (idempotent).
    if (isEncryptedSecretValue(tokens)) return;
    out.push({ provider, accountId, plaintext: tokens });
  };

  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const sql = pg(url);
    try {
      const rows = (await sql.unsafe(
        `SELECT provider, account_id, tokens FROM oauth_tokens`,
      )) as unknown as Array<{
        provider: string;
        account_id: string;
        tokens: string;
      }>;
      for (const row of rows) collect(row.provider, row.account_id, row.tokens);
    } finally {
      await sql.end();
    }
    return out;
  }

  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  try {
    const result = await client.execute({
      sql: `SELECT provider, account_id, tokens FROM oauth_tokens`,
    });
    for (const row of result.rows) {
      collect(
        row.provider as string,
        row.account_id as string,
        row.tokens as string,
      );
    }
  } finally {
    client.close();
  }
  return out;
}

async function updateRow(
  url: string,
  provider: string,
  accountId: string,
  tokens: string,
): Promise<void> {
  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const sql = pg(url);
    try {
      await sql.unsafe(
        `UPDATE oauth_tokens SET tokens = $1 WHERE provider = $2 AND account_id = $3`,
        [tokens, provider, accountId],
      );
    } finally {
      await sql.end();
    }
    return;
  }
  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  try {
    await client.execute({
      sql: `UPDATE oauth_tokens SET tokens = ? WHERE provider = ? AND account_id = ?`,
      args: [tokens, provider, accountId],
    });
  } finally {
    client.close();
  }
}
