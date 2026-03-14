#!/usr/bin/env tsx
/**
 * Run an arbitrary SQL query against BigQuery.
 *
 * Usage:
 *   npx tsx scripts/run.ts bigquery --sql="SELECT 1"
 */
import { parseArgs, output, fatal } from "./helpers";
import { runQuery } from "../server/lib/bigquery";

const args = parseArgs();
const sql = args.sql;
if (!sql) fatal("--sql is required. Example: --sql=\"SELECT 1\"");

const result = await runQuery(sql);
output(result);
