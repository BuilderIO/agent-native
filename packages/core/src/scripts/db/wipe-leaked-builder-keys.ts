/**
 * Core script: db-wipe-leaked-builder-keys
 *
 * Remove legacy BUILDER_* values from the persisted-env-vars settings row.
 */

import path from "node:path";

import { getDatabaseUrl } from "../../db/client.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

const BUILDER_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
  "BUILDER_SUBSCRIPTION",
  "BUILDER_SUBSCRIPTION_LEVEL",
  "BUILDER_SUBSCRIPTION_NAME",
  "BUILDER_IS_ENTERPRISE",
  "BUILDER_IS_FREE_ACCOUNT",
] as const;

function mask(value: unknown): string {
  if (typeof value !== "string" || value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
}

function stripBuilderKeys(row: Record<string, unknown>) {
  const keys = new Set<string>(BUILDER_KEYS);
  const cleaned: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (keys.has(key)) removed.push(key);
    else cleaned[key] = value;
  }
  return { cleaned, removed };
}

export default async function dbWipeLeakedBuilderKeys(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-wipe-leaked-builder-keys [options]

Removes BUILDER_* keys from the persisted-env-vars settings row.

Options:
  --db <path>   PGlite data directory (default: data/pglite)
  --dry-run     Print what would be removed without writing
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
      `SELECT value FROM settings WHERE key = 'persisted-env-vars'`,
    )) as Array<{ value: string }>;
    if (rows.length === 0) {
      console.log("[wipe-leaked-builder-keys] no persisted-env-vars row.");
      return;
    }
    const row = JSON.parse(rows[0].value) as Record<string, unknown>;
    const { cleaned, removed } = stripBuilderKeys(row);
    if (removed.length === 0) {
      console.log("[wipe-leaked-builder-keys] row already clean.");
      return;
    }
    for (const key of removed) console.log(`  - ${key}: ${mask(row[key])}`);
    if (dryRun) return;
    await client.unsafe(
      `UPDATE settings SET value = $1, updated_at = $2 WHERE key = 'persisted-env-vars'`,
      [JSON.stringify(cleaned), Date.now()],
    );
    console.log(`[wipe-leaked-builder-keys] removed ${removed.length} key(s).`);
  } finally {
    await client.end();
  }
}
