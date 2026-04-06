/**
 * Core script: db-check-scoping
 *
 * Validates that all template tables have the required ownership columns
 * (owner_email, org_id) for per-user and per-org data scoping.
 *
 * Tables without these columns are invisible to the scoping system and
 * will be accessible to all users in production mode.
 *
 * Usage:
 *   pnpm action db-check-scoping [--db path] [--require-org] [--format json]
 */

import path from "path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import { parseArgs } from "../utils.js";

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

interface TableColumn {
  table: string;
  column: string;
}

// Core tables that have their own scoping — skip these in validation
const CORE_TABLES = new Set([
  "settings",
  "application_state",
  "oauth_tokens",
  "sessions",
  // framework internal tables
  "resources",
  "chat_threads",
  "chat_messages",
  "chat_tasks",
  "recurring_jobs",
  // drizzle/migration tables
  "__drizzle_migrations",
  "_litestream_lock",
  "_litestream_seq",
]);

interface ValidationResult {
  table: string;
  hasOwnerEmail: boolean;
  hasOrgId: boolean;
  issues: string[];
}

function validate(
  allColumns: TableColumn[],
  requireOrg: boolean,
): ValidationResult[] {
  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }

  const results: ValidationResult[] = [];

  for (const [table, columns] of columnsByTable) {
    // Skip core/framework tables
    if (CORE_TABLES.has(table)) continue;
    // Skip migration-related tables
    if (table.startsWith("_")) continue;

    const hasOwnerEmail = columns.includes("owner_email");
    const hasOrgId = columns.includes("org_id");
    const issues: string[] = [];

    if (!hasOwnerEmail) {
      issues.push("missing owner_email column — not scoped per-user");
    }
    if (requireOrg && !hasOrgId) {
      issues.push("missing org_id column — not scoped per-org");
    }

    results.push({ table, hasOwnerEmail, hasOrgId, issues });
  }

  return results;
}

async function discoverColumnsPostgres(pgSql: any): Promise<TableColumn[]> {
  const rows: any[] = await pgSql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

async function discoverColumnsSqlite(client: any): Promise<TableColumn[]> {
  const tablesResult = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  );
  const tables = tablesResult.rows.map((r: any) => (r.name ?? r[0]) as string);

  const result: TableColumn[] = [];
  for (const table of tables) {
    const escaped = table.replace(/"/g, '""');
    const colsResult = await client.execute(`PRAGMA table_info("${escaped}")`);
    for (const row of colsResult.rows) {
      result.push({
        table,
        column: (row.name ?? row[1]) as string,
      });
    }
  }
  return result;
}

export default async function dbCheckScoping(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-check-scoping [options]

Options:
  --db <path>       Path to SQLite database (default: data/app.db)
  --require-org     Also check for org_id column (for multi-org apps)
  --format json     Output as JSON
  --help            Show this help message`);
    return;
  }

  const requireOrg = parsed["require-org"] === "true";
  const format = parsed.format;

  // Resolve database URL
  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  let allColumns: TableColumn[];

  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const pgSql = pg(url);
    try {
      allColumns = await discoverColumnsPostgres(pgSql);
    } finally {
      await pgSql.end();
    }
  } else {
    const client = createClient({
      url,
      authToken: getDatabaseAuthToken(),
    });
    try {
      allColumns = await discoverColumnsSqlite(client);
    } finally {
      client.close();
    }
  }

  const results = validate(allColumns, requireOrg);

  if (format === "json") {
    console.log(JSON.stringify({ tables: results }, null, 2));
    return;
  }

  const withIssues = results.filter((r) => r.issues.length > 0);
  const ok = results.filter((r) => r.issues.length === 0);

  if (ok.length > 0) {
    console.log("Scoped tables:");
    for (const r of ok) {
      const scopes = [
        r.hasOwnerEmail ? "owner_email" : null,
        r.hasOrgId ? "org_id" : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`  ✓ ${r.table} (${scopes})`);
    }
    console.log();
  }

  if (withIssues.length > 0) {
    console.log("Unscoped tables (WARNING):");
    for (const r of withIssues) {
      for (const issue of r.issues) {
        console.log(`  ✗ ${r.table} — ${issue}`);
      }
    }
    console.log();
    console.log(
      `${withIssues.length} table(s) lack scoping columns. ` +
        `In production, agents can see ALL rows in these tables regardless of user/org.`,
    );
    process.exitCode = 1;
  } else {
    console.log("All template tables have proper scoping columns.");
  }
}
