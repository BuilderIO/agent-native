/**
 * Core script: db-wipe-leaked-builder-keys
 *
 * One-shot cleanup for the legacy cross-tenant Builder credential leak.
 *
 * Pre-migration, the Builder OAuth callback wrote BUILDER_PRIVATE_KEY,
 * BUILDER_PUBLIC_KEY, BUILDER_USER_ID, BUILDER_ORG_NAME, BUILDER_ORG_KIND
 * into the unscoped `persisted-env-vars` settings row. On shared-DB
 * hosted templates that row was global, so the first user to connect
 * left their Builder identity sitting in `process.env` for every
 * subsequent tenant on the same serverless instance — anyone without
 * their own per-user app_secrets record fell back to the leaked key.
 *
 * Per-user Builder credentials now live in `app_secrets` (scope=user,
 * scopeId=email). The plugin init scrubs BUILDER_* on every boot, but
 * this script lets you wipe the row immediately, before redeploying.
 *
 * Idempotent. Re-running on a clean row is a no-op.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm action db-wipe-leaked-builder-keys
 *   DATABASE_URL=file:./data/app.db pnpm action db-wipe-leaked-builder-keys
 *   pnpm action db-wipe-leaked-builder-keys --db ./data/app.db
 *   pnpm action db-wipe-leaked-builder-keys --dry-run
 */

import path from "path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import { parseArgs } from "../utils.js";

const BUILDER_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
] as const;

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function maskValue(v: unknown): string {
  if (typeof v !== "string") return String(v);
  if (v.length <= 8) return "***";
  return `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})`;
}

export default async function dbWipeLeakedBuilderKeys(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-wipe-leaked-builder-keys [options]

Removes BUILDER_* keys from the persisted-env-vars row in the settings
table. Run this once per hosted template database.

Options:
  --db <path>   Path to SQLite database (default: data/app.db when no DATABASE_URL set)
  --dry-run     Print what would be removed without writing
  --help        Show this help message

Database resolution:
  --db flag → DATABASE_URL env → ./data/app.db`);
    return;
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
    `[wipe-leaked-builder-keys] target: ${dbLabel}${dryRun ? "  (dry-run)" : ""}`,
  );

  let row: Record<string, unknown> | null = null;

  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const pgSql = pg(url);
    try {
      const result = await pgSql.unsafe(
        `SELECT value FROM settings WHERE key = 'persisted-env-vars'`,
      );
      const rows = Array.from(result) as unknown as Array<{ value: string }>;
      if (rows.length === 0) {
        console.log("[wipe-leaked-builder-keys] no persisted-env-vars row.");
        return;
      }
      row = JSON.parse(rows[0].value);
      const { cleaned, removed } = stripBuilderKeys(row ?? {});
      if (removed.length === 0) {
        console.log(
          "[wipe-leaked-builder-keys] row already clean — nothing to do.",
        );
        return;
      }
      logRemoved(removed, row ?? {});
      if (dryRun) return;
      await pgSql.unsafe(
        `UPDATE settings SET value = $1, updated_at = $2 WHERE key = 'persisted-env-vars'`,
        [JSON.stringify(cleaned), Date.now()],
      );
      console.log(
        `[wipe-leaked-builder-keys] removed ${removed.length} key(s) from persisted-env-vars.`,
      );
    } finally {
      await pgSql.end();
    }
    return;
  }

  // libsql / SQLite
  const client = createClient({
    url,
    authToken: getDatabaseAuthToken(),
  });
  try {
    const result = await client.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: ["persisted-env-vars"],
    });
    if (result.rows.length === 0) {
      console.log("[wipe-leaked-builder-keys] no persisted-env-vars row.");
      return;
    }
    row = JSON.parse(result.rows[0].value as string);
    const { cleaned, removed } = stripBuilderKeys(row ?? {});
    if (removed.length === 0) {
      console.log(
        "[wipe-leaked-builder-keys] row already clean — nothing to do.",
      );
      return;
    }
    logRemoved(removed, row ?? {});
    if (dryRun) return;
    await client.execute({
      sql: `UPDATE settings SET value = ?, updated_at = ? WHERE key = ?`,
      args: [JSON.stringify(cleaned), Date.now(), "persisted-env-vars"],
    });
    console.log(
      `[wipe-leaked-builder-keys] removed ${removed.length} key(s) from persisted-env-vars.`,
    );
  } finally {
    client.close();
  }
}

function stripBuilderKeys(row: Record<string, unknown>): {
  cleaned: Record<string, unknown>;
  removed: string[];
} {
  const builderSet = new Set<string>(BUILDER_KEYS);
  const cleaned: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (builderSet.has(k)) {
      removed.push(k);
    } else {
      cleaned[k] = v;
    }
  }
  return { cleaned, removed };
}

function logRemoved(removed: string[], row: Record<string, unknown>): void {
  console.log(`[wipe-leaked-builder-keys] BUILDER_* keys present:`);
  for (const k of removed) {
    const masked =
      k === "BUILDER_ORG_NAME" || k === "BUILDER_ORG_KIND"
        ? String(row[k])
        : maskValue(row[k]);
    console.log(`  - ${k}: ${masked}`);
  }
}
