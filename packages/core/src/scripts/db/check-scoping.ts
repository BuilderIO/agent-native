/**
 * Core script: db-check-scoping
 *
 * Validate that application tables expose owner_email and, when requested,
 * org_id for raw database-tool scoping.
 */

import path from "node:path";

import { getDatabaseUrl } from "../../db/client.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

interface TableColumn {
  table: string;
  column: string;
}

const CORE_TABLES = new Set([
  "settings",
  "application_state",
  "oauth_tokens",
  "sessions",
  "resources",
  "chat_threads",
  "chat_messages",
  "chat_tasks",
  "recurring_jobs",
]);

interface ValidationResult {
  table: string;
  hasOwnerEmail: boolean;
  hasOrgId: boolean;
  issues: string[];
}

function validate(
  columns: TableColumn[],
  requireOrg: boolean,
): ValidationResult[] {
  const byTable = new Map<string, string[]>();
  for (const { table, column } of columns) {
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  const results: ValidationResult[] = [];
  for (const [table, tableColumns] of byTable) {
    if (CORE_TABLES.has(table) || table.startsWith("_")) continue;
    const hasOwnerEmail = tableColumns.includes("owner_email");
    const hasOrgId = tableColumns.includes("org_id");
    const issues = [
      hasOwnerEmail ? null : "missing owner_email column",
      requireOrg && !hasOrgId ? "missing org_id column" : null,
    ].filter((issue): issue is string => issue !== null);
    results.push({ table, hasOwnerEmail, hasOrgId, issues });
  }
  return results;
}

async function discoverColumns(client: {
  unsafe(sql: string, args?: unknown[]): Promise<unknown[]>;
}): Promise<TableColumn[]> {
  const rows = (await client.unsafe(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )) as Array<{ table_name: string; column_name: string }>;
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
  }));
}

export default async function dbCheckScoping(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-check-scoping [options]

Options:
  --db <path>       PGlite data directory (default: data/pglite)
  --require-org     Also check for org_id columns
  --format json     Output as JSON
  --help            Show this help message`);
    return;
  }
  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);
  try {
    const results = validate(
      await discoverColumns(client),
      parsed["require-org"] === "true",
    );
    if (parsed.format === "json") {
      console.log(JSON.stringify({ tables: results }, null, 2));
      return;
    }
    const issues = results.filter((result) => result.issues.length > 0);
    for (const result of results) {
      if (result.issues.length === 0) {
        const scopes = [
          result.hasOwnerEmail ? "owner_email" : null,
          result.hasOrgId ? "org_id" : null,
        ]
          .filter(Boolean)
          .join(", ");
        console.log(`  ✓ ${result.table} (${scopes})`);
      }
    }
    if (issues.length > 0) {
      console.log("Tables denied to raw database tools:");
      for (const result of issues) {
        for (const issue of result.issues)
          console.log(`  ✗ ${result.table}: ${issue}`);
      }
      process.exitCode = 1;
    } else {
      console.log("All application tables have proper scoping columns.");
    }
  } finally {
    await client.end();
  }
}
