/**
 * Core script: db-migrate-encrypt-credentials
 *
 * Encrypt plaintext credential rows in the settings table in place.
 */

import path from "node:path";

import { getDatabaseUrl } from "../../db/client.js";
import {
  encryptSecretValue,
  isEncryptedSecretValue,
} from "../../secrets/crypto.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

interface CredentialRow {
  settingsKey: string;
  plaintext: string;
}

const CREDENTIAL_LIKE = "%:credential:%";

function extractValue(raw: string): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw)?.value;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
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

export default async function dbMigrateEncryptCredentials(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-migrate-encrypt-credentials [options]

Encrypts plaintext credential rows in settings in place.

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
  console.log(
    `[migrate-encrypt-credentials] target: ${databaseLabel(url)}${dryRun ? " (dry-run)" : ""}`,
  );

  const client = await createPostgresScriptClient(url);
  try {
    const rows = (await client.unsafe(
      `SELECT key, value FROM settings WHERE key LIKE $1`,
      [CREDENTIAL_LIKE],
    )) as Array<{ key: string; value: string }>;
    const candidates: CredentialRow[] = [];
    for (const row of rows) {
      if (!row.key.includes(":credential:")) continue;
      const plaintext = extractValue(row.value);
      if (plaintext && !isEncryptedSecretValue(plaintext)) {
        candidates.push({ settingsKey: row.key, plaintext });
      }
    }
    if (candidates.length === 0) {
      console.log("[migrate-encrypt-credentials] nothing to encrypt.");
      return;
    }
    for (const row of candidates)
      console.log(`  - ${row.settingsKey} ${mask(row.plaintext)}`);
    if (dryRun) return;
    let encrypted = 0;
    for (const row of candidates) {
      await client.unsafe(`UPDATE settings SET value = $1 WHERE key = $2`, [
        JSON.stringify({ value: encryptSecretValue(row.plaintext) }),
        row.settingsKey,
      ]);
      encrypted++;
    }
    console.log(`[migrate-encrypt-credentials] done. encrypted=${encrypted}`);
  } finally {
    await client.end();
  }
}
