/**
 * Core script: db-reset-dev-owner
 *
 * Reassign rows owned by the local development sentinel to a real account.
 * Local execution uses PGlite and hosted execution uses PostgreSQL.
 */

import path from "node:path";

import { getDatabaseUrl } from "../../db/client.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

const DEV_FALLBACK_EMAIL = "local@localhost"; // guard:allow-localhost-fallback - intentional dev-owner migration sentinel

interface ScriptArgs {
  to: string;
  table?: string;
  dryRun: boolean;
}

function printHelp(): void {
  console.log(`Usage: pnpm action db-reset-dev-owner --to <email> [options]

Reassign rows owned by '${DEV_FALLBACK_EMAIL}' across tables with an owner_email column.

Options:
  --table <name>  Only reset one table
  --dry-run       Print what would change without writing
  --db <path>     PGlite data directory (default: data/pglite)
  --help          Show this help message`);
}

function parseScriptArgs(args: string[]): ScriptArgs {
  const parsed = parseArgs(args);
  const to = parsed.to?.trim();
  if (!to || !to.includes("@") || to === DEV_FALLBACK_EMAIL) {
    throw new Error("--to must be a different email address");
  }
  return {
    to,
    table: parsed.table?.trim() || undefined,
    dryRun: parsed["dry-run"] === "true",
  };
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid table name: ${value}`);
  }
  return `"${value}"`;
}

async function discoverOwnerTables(client: {
  unsafe(sql: string, args?: unknown[]): Promise<unknown[]>;
}): Promise<string[]> {
  const rows = (await client.unsafe(
    `SELECT DISTINCT table_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'owner_email'
      ORDER BY table_name`,
  )) as Array<{ table_name: string }>;
  return rows.map((row) => row.table_name);
}

export default async function dbResetDevOwner(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help")) {
    printHelp();
    return;
  }
  const parsed = parseScriptArgs(args);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run db-reset-dev-owner in production.");
  }

  const dbPath = parseArgs(args).db?.trim();
  const url = dbPath
    ? `pglite:${path.resolve(dbPath)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);
  try {
    await client.begin(async (tx) => {
      const tables = parsed.table
        ? [parsed.table]
        : await discoverOwnerTables(tx);
      let totalUpdated = 0;
      for (const table of tables) {
        const identifier = quoteIdentifier(table);
        const countRows = (await tx.unsafe(
          `SELECT COUNT(*)::int AS count FROM ${identifier} WHERE owner_email = $1`,
          [DEV_FALLBACK_EMAIL],
        )) as Array<{ count: number }>;
        const count = Number(countRows[0]?.count ?? 0);
        console.log(
          `  ${table}: ${count} row(s)${parsed.dryRun ? " (dry-run)" : ""}`,
        );
        if (parsed.dryRun || count === 0) continue;
        const result = await tx.unsafe(
          `UPDATE ${identifier} SET owner_email = $1 WHERE owner_email = $2`,
          [parsed.to, DEV_FALLBACK_EMAIL],
        );
        totalUpdated += result.count ?? 0;
      }
      console.log(
        parsed.dryRun
          ? "[reset-dev-owner] dry-run complete."
          : `[reset-dev-owner] reassigned ${totalUpdated} row(s) across ${tables.length} table(s).`,
      );
    });
  } finally {
    await client.end();
  }
}
