/**
 * Core script: db-schema
 *
 * Inspect the configured PostgreSQL database and print its tables, columns,
 * constraints, foreign keys, and indexes. Local execution uses PGlite.
 */

import path from "node:path";

import { getDatabaseUrl } from "../../db/client.js";
import { parseArgs } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";

interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  dflt_value: string | null;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  foreignKeys: { from: string; table: string; to: string }[];
  indexes: { name: string; unique: boolean; columns: string[] }[];
}

function databaseLabel(url: string): string {
  if (url.startsWith("pglite:")) return url;
  try {
    const parsed = new URL(url);
    const auth = parsed.username ? `${parsed.username}:***@` : "";
    return `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}`;
  } catch {
    return url.replace(/:\/\/([^:@\s]+):([^@\s]+)@/, "://$1:***@");
  }
}

async function inspectDatabase(
  client: Awaited<ReturnType<typeof createPostgresScriptClient>>,
  url: string,
  format?: string,
): Promise<void> {
  const tables = (await client.unsafe(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  )) as Array<{ name: string }>;
  const tableInfos: TableInfo[] = [];

  for (const table of tables) {
    const columns = (await client.unsafe(
      `SELECT column_name AS name,
              data_type AS type,
              (is_nullable = 'NO') AS notnull,
              column_default AS dflt_value
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table.name],
    )) as Array<{
      name: string;
      type: string;
      notnull: boolean;
      dflt_value: string | null;
    }>;
    const primaryKeys = (await client.unsafe(
      `SELECT kcu.column_name AS name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'PRIMARY KEY'`,
      [table.name],
    )) as Array<{ name: string }>;
    const primaryKeyNames = new Set(primaryKeys.map((key) => key.name));
    const foreignKeys = (await client.unsafe(
      `SELECT kcu.column_name AS "from",
              ccu.table_name AS table,
              ccu.column_name AS "to"
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'FOREIGN KEY'`,
      [table.name],
    )) as Array<{ from: string; table: string; to: string }>;
    const indexRows = (await client.unsafe(
      `SELECT indexname AS name, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1`,
      [table.name],
    )) as Array<{ name: string; indexdef: string }>;

    tableInfos.push({
      name: table.name,
      columns: columns.map((column) => ({
        ...column,
        pk: primaryKeyNames.has(column.name),
      })),
      foreignKeys,
      indexes: indexRows.map((index) => {
        const match = index.indexdef.match(/\(([^)]+)\)/);
        return {
          name: index.name,
          unique: /\bUNIQUE\b/i.test(index.indexdef),
          columns: match
            ? match[1].split(",").map((value) => value.trim())
            : [],
        };
      }),
    });
  }

  if (format === "json") {
    console.log(
      JSON.stringify(
        { database: databaseLabel(url), tables: tableInfos },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`Database: ${databaseLabel(url)}`);
  console.log(`Tables: ${tableInfos.length}\n`);
  for (const table of tableInfos) {
    console.log(`Table: ${table.name} (${table.columns.length} columns)`);
    const foreignKeyMap = new Map(
      table.foreignKeys.map((key) => [key.from, `${key.table}(${key.to})`]),
    );
    const nameWidth = Math.max(
      1,
      ...table.columns.map((column) => column.name.length),
    );
    const typeWidth = Math.max(
      1,
      ...table.columns.map((column) => column.type.length),
    );
    for (const column of table.columns) {
      const details = [
        column.pk ? "PRIMARY KEY" : null,
        column.notnull && !column.pk ? "NOT NULL" : null,
        column.dflt_value ? `DEFAULT ${column.dflt_value}` : null,
        foreignKeyMap.get(column.name),
      ].filter(Boolean);
      console.log(
        `  ${column.name.padEnd(nameWidth)}  ${column.type.padEnd(typeWidth)}${details.length ? `  ${details.join(", ")}` : ""}`,
      );
    }
    for (const index of table.indexes) {
      console.log(
        `  Index: ${index.unique ? "UNIQUE " : ""}${index.name} (${index.columns.join(", ")})`,
      );
    }
    console.log();
  }
}

export default async function dbSchema(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-schema [--db <path>] [--format json]

Options:
  --db <path>     PGlite data directory (default: data/pglite)
  --format json   Output as JSON instead of human-readable text
  --help          Show this help message`);
    return;
  }
  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);
  try {
    await inspectDatabase(client, url, parsed.format);
  } finally {
    await client.end();
  }
}
