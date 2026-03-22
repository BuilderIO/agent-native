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
import fs from "fs";
import Database from "better-sqlite3";
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

  const dbPath = parsed.db || path.join(process.cwd(), "data", "app.db");

  if (!fs.existsSync(dbPath)) {
    fail(`Database not found at ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    const tables: { name: string }[] = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as any;

    const tableInfos: TableInfo[] = tables.map((t) => {
      const escaped = t.name.replace(/"/g, '""');
      const columns = db.pragma(`table_info("${escaped}")`) as any[];
      const fks = db.pragma(`foreign_key_list("${escaped}")`) as any[];
      const idxList = db.pragma(`index_list("${escaped}")`) as any[];

      const indexes = idxList
        .filter((idx) => !idx.name.startsWith("sqlite_"))
        .map((idx) => {
          const idxInfo = db.pragma(
            `index_info("${idx.name.replace(/"/g, '""')}")`,
          ) as any[];
          return {
            name: idx.name,
            unique: idx.unique === 1,
            columns: idxInfo.map((c) => c.name),
          };
        });

      return {
        name: t.name,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type || "ANY",
          notnull: c.notnull === 1,
          pk: c.pk === 1,
          dflt_value: c.dflt_value,
        })),
        foreignKeys: fks.map((fk) => ({
          from: fk.from,
          table: fk.table,
          to: fk.to,
        })),
        indexes,
      };
    });

    if (parsed.format === "json") {
      console.log(
        JSON.stringify({ database: dbPath, tables: tableInfos }, null, 2),
      );
      return;
    }

    // Human-readable output
    console.log(`Database: ${dbPath}`);
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
    db.close();
  }
}
