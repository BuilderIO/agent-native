/**
 * Core script: db-migrate-user-api-keys
 *
 * Move legacy user API-key settings rows into encrypted app_secrets rows.
 */

import path from "node:path";

import { PROVIDER_TO_ENV } from "../../agent/engine/provider-env-vars.js";
import { getDatabaseUrl } from "../../db/client.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

interface LegacyRow {
  settingsKey: string;
  provider: string;
  email: string;
  apiKey: string;
}

function parseLegacyKey(key: string): { provider: string; email: string } | null {
  if (key.startsWith("user-api-key:")) {
    const rest = key.slice("user-api-key:".length);
    const separator = rest.indexOf(":");
    if (separator <= 0) return null;
    return { provider: rest.slice(0, separator), email: rest.slice(separator + 1) };
  }
  if (key.startsWith("user-anthropic-api-key:")) {
    return { provider: "anthropic", email: key.slice("user-anthropic-api-key:".length) };
  }
  return null;
}

function secretKeyForProvider(provider: string): string {
  return PROVIDER_TO_ENV[provider] ?? `${provider.toUpperCase()}_API_KEY`;
}

function extractKey(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    if (parsed && typeof parsed.key === "string" && parsed.key.trim()) return parsed.key.trim();
  } catch {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function mask(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
}

export default async function dbMigrateUserApiKeys(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-migrate-user-api-keys [options]

Moves legacy user API-key settings rows into app_secrets.

Options:
  --db <path>   PGlite data directory (default: data/pglite)
  --dry-run     Print what would be migrated without writing
  --help        Show this help message`);
    return;
  }
  const dryRun = parsed["dry-run"] === "true";
  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);
  try {
    const rows = (await client.unsafe(
      `SELECT key, value FROM settings
       WHERE key LIKE 'user-api-key:%' OR key LIKE 'user-anthropic-api-key:%'`,
    )) as Array<{ key: string; value: string }>;
    const legacy: LegacyRow[] = [];
    for (const row of rows) {
      const key = parseLegacyKey(row.key);
      const apiKey = key && extractKey(row.value);
      if (key && apiKey) legacy.push({ settingsKey: row.key, ...key, apiKey });
    }
    if (legacy.length === 0) {
      console.log("[migrate-user-api-keys] nothing to migrate.");
      return;
    }
    for (const row of legacy) {
      console.log(`  - ${row.email} ${row.provider} -> ${secretKeyForProvider(row.provider)} ${mask(row.apiKey)}`);
    }
    if (dryRun) return;

    if (parsed.db) {
      process.env.DATABASE_URL = url; // guard:allow-env-mutation - pin downstream secret writes to the selected database
    }
    const { writeAppSecret } = await import("../../secrets/storage.js");
    let migrated = 0;
    for (const row of legacy) {
      await writeAppSecret({
        key: secretKeyForProvider(row.provider),
        value: row.apiKey,
        scope: "user",
        scopeId: row.email,
      });
      await client.unsafe(`DELETE FROM settings WHERE key = $1`, [row.settingsKey]);
      migrated++;
    }
    console.log(`[migrate-user-api-keys] done. migrated=${migrated}`);
  } finally {
    await client.end();
  }
}
