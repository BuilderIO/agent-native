#!/usr/bin/env tsx
import { runQuery } from "../server/lib/bigquery";
import { output } from "./helpers";

async function main() {
  const sql = `
    SELECT column_name, data_type
    FROM \`your-gcp-project-id.hubspot.INFORMATION_SCHEMA.COLUMNS\`
    WHERE table_name = 'form_submissions'
    ORDER BY ordinal_position
  `;

  const result = await runQuery(sql);
  output(result.rows);
}

export default main;
