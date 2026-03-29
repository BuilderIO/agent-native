#!/usr/bin/env tsx
/**
 * Run an arbitrary SQL query against a connected PostgreSQL database.
 *
 * Usage:
 *   pnpm script postgres-query --sql="SELECT * FROM users LIMIT 10"
 *   pnpm script postgres-query --sql="SELECT count(*) FROM orders" --format=json
 */
import { parseArgs, output, fatal } from "./helpers";
import { runQuery } from "../server/lib/postgres";

const args = parseArgs();
const sql = args.sql;
if (!sql) fatal('--sql is required. Example: --sql="SELECT 1"');

const format = args.format || "table";

const rows = await runQuery(sql);

if (format === "table" && Array.isArray(rows) && rows.length > 0) {
  console.table(rows);
} else {
  output(rows);
}
