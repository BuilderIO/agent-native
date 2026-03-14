#!/usr/bin/env tsx
import { runQuery } from "../server/lib/bigquery";
import { output } from "./helpers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(
    join(__dirname, "test-inbound-outbound-query.sql"),
    "utf-8",
  );

  console.error("Running query to test inbound/outbound classification...");
  console.error("This query:");
  console.error(
    "1. Finds qualifying forms (Sales, demo, Component Indexing, Unlock Ent Trial)",
  );
  console.error("2. Joins deals → contacts → forms");
  console.error("3. Filters where form_fill_date < deal.createdate");
  console.error(
    "4. Classifies as Inbound if ANY qualifying form exists, else Outbound",
  );
  console.error("");

  const result = await runQuery(sql);

  console.error(
    `\nQuery completed. Bytes processed: ${(result.bytesProcessed / 1e9).toFixed(2)} GB`,
  );
  console.error(`Total rows: ${result.totalRows}\n`);

  output(result.rows);
}

main().catch(console.error);
