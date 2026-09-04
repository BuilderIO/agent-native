/**
 * Core script: db-migrate-encrypt-oauth-tokens
 *
 * Encrypt plaintext OAuth payloads in the oauth_tokens table in place.
 */

import path from "node:path";

import { getDatabaseUrl } from "../../db/client.js";
import {
  encryptSecretValue,
  isEncryptedSecretValue,
} from "../../secrets/crypto.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

interface OAuthTokenRow {
  provider: string;
  accountId: string;
  plaintext: string;
}

function mask(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 3)}...${value.slice(-3)} (len=${value.length})`;
}

function databaseLabel(url: string): string {
  if (url.startsWith("pglite:")) return url;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export default async function dbMigrateEncryptOAuthTokens(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-migrate-encrypt-oauth-tokens [options]

Encrypts plaintext token payloads in oauth_tokens in place.

Options:
  --db <path>   PGlite data directory (default: data/pglite)
  --dry-run     Print what would be encrypted without writing
  --help        Show this help message`);
    return;
  }
  if (!process.env.SECRETS_ENCRYPTION_KEY && !process.env.BETTER_AUTH_SECRET) {
    throw new Error("Set SECRETS_ENCRYPTION_KEY or BETTER_AUTH_SECRET first");
  }

  const dryRun = parsed["dry-run"] === "true";
  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  console.log(`[migrate-encrypt-oauth-tokens] target: ${databaseLabel(url)}${dryRun ? " (dry-run)" : ""}`);

  const client = await createPostgresScriptClient(url);
  try {
    const rows = (await client.unsafe(
      `SELECT provider, account_id, tokens FROM oauth_tokens`,
    )) as Array<{ provider: string; account_id: string; tokens: string }>;
    const candidates: OAuthTokenRow[] = rows
      .filter((row) => row.tokens && !isEncryptedSecretValue(row.tokens))
      .map((row) => ({
        provider: row.provider,
        accountId: row.account_id,
        plaintext: row.tokens,
      }));
    if (candidates.length === 0) {
      console.log("[migrate-encrypt-oauth-tokens] nothing to encrypt.");
      return;
    }
    for (const row of candidates) console.log(`  - ${row.provider}:${row.accountId} ${mask(row.plaintext)}`);
    if (dryRun) return;
    for (const row of candidates) {
      await client.unsafe(
        `UPDATE oauth_tokens SET tokens = $1 WHERE provider = $2 AND account_id = $3`,
        [encryptSecretValue(row.plaintext), row.provider, row.accountId],
      );
    }
    console.log(`[migrate-encrypt-oauth-tokens] done. encrypted=${candidates.length}`);
  } finally {
    await client.end();
  }
}
