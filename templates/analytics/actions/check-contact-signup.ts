#!/usr/bin/env tsx
import { runQuery } from "../server/lib/bigquery";
import { output } from "./helpers";

async function main() {
  const sql = `
    SELECT 
      contact_id,
      email,
      builder_user_id,
      sign_up_time_stamp,
      sign_up_time_stamp_time
    FROM \`your-gcp-project-id.dbt_mart.dim_hs_contacts\`
    WHERE sign_up_time_stamp IS NOT NULL
    ORDER BY sign_up_time_stamp DESC
    LIMIT 10
  `;

  const result = await runQuery(sql);
  console.error(`Found ${result.totalRows} contacts with sign_up_time_stamp`);
  output(result.rows);
}

main().catch(console.error);
