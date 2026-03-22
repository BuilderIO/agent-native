/**
 * Core script: db-schema
 *
 * Inspects a SQLite database and prints all tables, columns, types,
 * constraints, and foreign keys. Gives the agent full visibility
 * into the app's data model.
 *
 * Usage:
 *   pnpm script db-schema [--db path] [--format json]
 */

import path from "path";
import { createClient, type Client } from "@libsql/client";
import { parseArgs, fail } from "../utils.js";

interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  dflt_value: string | null;
}

interface ForeignKey {
  from: string;
  table: string;
  to: string;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
  indexes: { name: string; unique: boolean; columns: string[] }[];
}

/**
 * Execute a PRAGMA query and return the rows as plain objects.
 */
async function pragma(
  client: Client,
  pragmaQuery: string,
): Promise<Record<string, unknown>[]> {
  const result = await client.execute(pragmaQuery);
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i++) {
      obj[result.columns[i]] = row[i];
    }
    return obj;
  });
}

export default async function dbSchema(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm script db-schema [--db <path>] [--format json]

Options:
  --db <path>     Path to SQLite database (default: data/app.db)
  --format json   Output as JSON instead of human-readable text
  --help          Show this help message`);
    return;
  }

  // Resolve database URL: --db flag → DATABASE_URL env → default file path
  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (process.env.DATABASE_URL) {
    url = process.env.DATABASE_URL;
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  try {
    const tablesResult = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const tables = tablesResult.rows.map((row) => ({
      name: row[0] as string,
    }));

    const tableInfos: TableInfo[] = [];

    for (const t of tables) {
      const escaped = t.name.replace(/"/g, '""');

      const columns = await pragma(client, `PRAGMA table_info("${escaped}")`);
      const fks = await pragma(client, `PRAGMA foreign_key_list("${escaped}")`);
      const idxList = await pragma(client, `PRAGMA index_list("${escaped}")`);

      const indexes: { name: string; unique: boolean; columns: string[] }[] =
        [];
      for (const idx of idxList) {
        const idxName = idx.name as string;
        if (idxName.startsWith("sqlite_")) continue;
        const idxInfo = await pragma(
          client,
          `PRAGMA index_info("${idxName.replace(/"/g, '""')}")`,
        );
        indexes.push({
          name: idxName,
          unique: idx.unique === 1,
          columns: idxInfo.map((c) => c.name as string),
        });
      }

      tableInfos.push({
        name: t.name,
        columns: columns.map((c) => ({
          name: c.name as string,
          type: (c.type as string) || "ANY",
          notnull: c.notnull === 1,
          pk: c.pk === 1,
          dflt_value: c.dflt_value as string | null,
        })),
        foreignKeys: fks.map((fk) => ({
          from: fk.from as string,
          table: fk.table as string,
          to: fk.to as string,
        })),
        indexes,
      });
    }

    if (parsed.format === "json") {
      const dbLabel = url.startsWith("file:") ? url.slice(5) : url;
      console.log(
        JSON.stringify({ database: dbLabel, tables: tableInfos }, null, 2),
      );
      return;
    }

    // Human-readable output
    const dbLabel = url.startsWith("file:") ? url.slice(5) : url;
    console.log(`Database: ${dbLabel}`);
    console.log(`Tables: ${tableInfos.length}\n`);

    for (const table of tableInfos) {
      console.log(`Table: ${table.name} (${table.columns.length} columns)`);

      // Build FK lookup for annotation
      const fkMap = new Map<string, string>();
      for (const fk of table.foreignKeys) {
        fkMap.set(fk.from, `${fk.table}(${fk.to})`);
      }

      // Find max widths for alignment
      const nameWidth = Math.max(...table.columns.map((c) => c.name.length));
      const typeWidth = Math.max(...table.columns.map((c) => c.type.length));

      for (const col of table.columns) {
        const parts: string[] = [];
        if (col.pk) parts.push("PRIMARY KEY");
        if (col.notnull && !col.pk) parts.push("NOT NULL");
        if (col.dflt_value !== null) parts.push(`DEFAULT ${col.dflt_value}`);
        const fkRef = fkMap.get(col.name);
        if (fkRef) parts.push(`→ ${fkRef}`);

        const constraint = parts.length > 0 ? `  ${parts.join(", ")}` : "";
        console.log(
          `  ${col.name.padEnd(nameWidth)}  ${col.type.padEnd(typeWidth)}${constraint}`,
        );
      }

      if (table.indexes.length > 0) {
        console.log(`  Indexes:`);
        for (const idx of table.indexes) {
          const unique = idx.unique ? "UNIQUE " : "";
          console.log(`    ${unique}${idx.name} (${idx.columns.join(", ")})`);
        }
      }

      console.log();
    }
  } finally {
    client.close();
  }
}
