/**
 * Core script: db-reset-dev-owner
 *
 * One-shot fix for local DBs that accumulated rows owned by the dev
 * sentinel `local@localhost`. Pre-changes-53, db-exec / db-query /
 * db-patch silently fell back to that owner when no real identity was
 * present, so any data created via CLI runs (or by older versions of
 * the runner) landed under the sentinel and is now invisible to the
 * actual signed-in user.
 *
 * This script discovers every ownable table (those with an
 * `owner_email` column), then re-points each `local@localhost` row to
 * the email passed via `--to`. Optionally restricted to a single table
 * with `--table`.
 *
 * Local-dev-only safety: refuses to run when `NODE_ENV=production` or
 * when targeting a non-`file:` SQLite URL (no Postgres / Turso /
 * shared-DB writes).
 *
 * Usage:
 *   pnpm action db-reset-dev-owner --to matthew@builder.io
 *   pnpm action db-reset-dev-owner --to matthew@builder.io --dry-run
 *   pnpm action db-reset-dev-owner --to matthew@builder.io --table decks
 *   pnpm action db-reset-dev-owner --to matthew@builder.io --db ./data/app.db
 */

import path from "path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import { parseArgs } from "../utils.js";

const DEV_FALLBACK_EMAIL = "local@localhost"; // guard:allow-localhost-fallback — script intentionally targets these rows

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

interface Args {
  to: string;
  table?: string;
  dryRun: boolean;
  dbPath?: string;
}

function parseScriptArgs(args: string[]): Args | null {
  const parsed = parseArgs(args);
  if (parsed.help === "true") return null;

  const to = parsed.to?.trim();
  if (!to || !to.includes("@")) {
    console.error(
      "Error: --to <email> is required and must look like an email address.",
    );
    return null;
  }
  if (to === DEV_FALLBACK_EMAIL) {
    console.error(
      `Error: --to cannot be ${DEV_FALLBACK_EMAIL} (that's the sentinel we're fixing).`,
    );
    return null;
  }

  return {
    to,
    table: parsed.table?.trim() || undefined,
    dryRun: parsed["dry-run"] === "true",
    dbPath: parsed.db?.trim() || undefined,
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm action db-reset-dev-owner --to <email> [options]

Reassigns rows owned by '${DEV_FALLBACK_EMAIL}' to the given email across
every table that has an 'owner_email' column. Use this once when an old
local DB still has rows that the new (post-changes-53) scoping won't show
to the actual signed-in user.

Required:
  --to <email>    Target email — usually the address you sign in with locally

Options:
  --table <name>  Only reset one table (default: every ownable table)
  --dry-run       Print what would change without writing
  --db <path>     SQLite database path (default: DATABASE_URL or ./data/app.db)
  --help          Show this help message

Refuses to run when NODE_ENV=production or against a non-local DB URL.`);
}

export default async function dbResetDevOwner(args: string[]): Promise<void> {
  if (args.includes("--help") || args.length === 0) {
    printHelp();
    return;
  }

  const parsed = parseScriptArgs(args);
  if (!parsed) {
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "Error: refusing to run db-reset-dev-owner with NODE_ENV=production.",
    );
    process.exit(1);
  }

  // Resolve target DB URL — same precedence as wipe-leaked-builder-keys.
  let url: string;
  if (parsed.dbPath) {
    url = "file:" + path.resolve(parsed.dbPath);
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  const isPostgres = isPostgresUrl(url);
  const isLocalSqlite = url.startsWith("file:");

  if (!isPostgres && !isLocalSqlite) {
    console.error(
      `Error: refusing to run against shared DB URL ${url}. ` +
        "This script is only for local SQLite files.",
    );
    process.exit(1);
  }
  if (isPostgres && process.env.AN_ALLOW_PG_DEV_OWNER_RESET !== "1") {
    console.error(
      "Error: refusing to run against a Postgres DB. Set " +
        "AN_ALLOW_PG_DEV_OWNER_RESET=1 to override (only do this on a " +
        "local Postgres you fully own — never on Neon/prod).",
    );
    process.exit(1);
  }

  const dbLabel = isLocalSqlite
    ? url.slice("file:".length)
    : (() => {
        try {
          return new URL(url).host || url;
        } catch {
          return url;
        }
      })();

  console.log(
    `[reset-dev-owner] target: ${dbLabel}` +
      `${parsed.dryRun ? "  (dry-run)" : ""}`,
  );
  console.log(
    `[reset-dev-owner] reassigning '${DEV_FALLBACK_EMAIL}' → '${parsed.to}'`,
  );

  if (isPostgres) {
    await runPostgres(url, parsed);
  } else {
    await runSqlite(url, parsed);
  }
}

async function runSqlite(url: string, args: Args): Promise<void> {
  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  try {
    const tables = args.table
      ? [args.table]
      : await discoverSqliteOwnerTables(client);

    if (tables.length === 0) {
      console.log(
        "[reset-dev-owner] no tables with owner_email column — nothing to do.",
      );
      return;
    }

    let totalUpdated = 0;
    for (const table of tables) {
      const escaped = table.replace(/"/g, '""');
      const countRes = await client.execute({
        sql: `SELECT COUNT(*) AS c FROM "${escaped}" WHERE owner_email = ?`,
        args: [DEV_FALLBACK_EMAIL],
      });
      const count = Number((countRes.rows[0] as any)?.c ?? 0);
      if (count === 0) {
        console.log(`  ${table}: 0 rows`);
        continue;
      }
      console.log(
        `  ${table}: ${count} row(s)${args.dryRun ? "  (dry-run)" : ""}`,
      );
      if (args.dryRun) continue;
      const updateRes = await client.execute({
        sql: `UPDATE "${escaped}" SET owner_email = ? WHERE owner_email = ?`,
        args: [args.to, DEV_FALLBACK_EMAIL],
      });
      totalUpdated += updateRes.rowsAffected;
    }

    console.log(
      args.dryRun
        ? `[reset-dev-owner] dry-run complete.`
        : `[reset-dev-owner] reassigned ${totalUpdated} row(s) across ${tables.length} table(s).`,
    );
  } finally {
    client.close();
  }
}

async function runPostgres(url: string, args: Args): Promise<void> {
  const { default: pg } = await import("postgres");
  const sql = pg(url);
  try {
    const tables = args.table
      ? [args.table]
      : await discoverPostgresOwnerTables(sql);

    if (tables.length === 0) {
      console.log(
        "[reset-dev-owner] no tables with owner_email column — nothing to do.",
      );
      return;
    }

    let totalUpdated = 0;
    for (const table of tables) {
      const countRes = (await sql.unsafe(
        `SELECT COUNT(*)::int AS c FROM "${table.replace(/"/g, '""')}" WHERE owner_email = $1`,
        [DEV_FALLBACK_EMAIL],
      )) as unknown as Array<{ c: number }>;
      const count = countRes[0]?.c ?? 0;
      if (count === 0) {
        console.log(`  ${table}: 0 rows`);
        continue;
      }
      console.log(
        `  ${table}: ${count} row(s)${args.dryRun ? "  (dry-run)" : ""}`,
      );
      if (args.dryRun) continue;
      const updateRes = (await sql.unsafe(
        `UPDATE "${table.replace(/"/g, '""')}" SET owner_email = $1 WHERE owner_email = $2`,
        [args.to, DEV_FALLBACK_EMAIL],
      )) as unknown as { count?: number };
      totalUpdated += updateRes.count ?? 0;
    }

    console.log(
      args.dryRun
        ? `[reset-dev-owner] dry-run complete.`
        : `[reset-dev-owner] reassigned ${totalUpdated} row(s) across ${tables.length} table(s).`,
    );
  } finally {
    await sql.end();
  }
}

async function discoverSqliteOwnerTables(client: any): Promise<string[]> {
  const tablesRes = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  );
  const out: string[] = [];
  for (const row of tablesRes.rows) {
    const table = (row.name ?? row[0]) as string;
    const escaped = table.replace(/"/g, '""');
    const colsRes = await client.execute(`PRAGMA table_info("${escaped}")`);
    const hasOwner = colsRes.rows.some(
      (r: any) => (r.name ?? r[1]) === "owner_email",
    );
    if (hasOwner) out.push(table);
  }
  return out;
}

async function discoverPostgresOwnerTables(sql: any): Promise<string[]> {
  const rows = (await sql`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'owner_email'
    ORDER BY table_name
  `) as unknown as Array<{ table_name: string }>;
  return Array.from(rows).map((r) => r.table_name);
}
