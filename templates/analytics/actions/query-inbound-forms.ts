import { defineAction } from "@agent-native/core";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description: "Query inbound sales/demo form submissions from BigQuery.",
  parameters: {},
  http: false,
  run: async () => {
    const sql = `
SELECT
  form_name,
  conversion_details,
  form_type,
  form_intent,
  COUNT(*) as submission_count,
  MIN(form_fill_date) as earliest_submission,
  MAX(form_fill_date) as latest_submission
FROM \`your-gcp-project-id.dbt_intermediate.hubspot_form_submissions\`
WHERE form_name IS NOT NULL
  AND (
    LOWER(form_name) LIKE '%sales%'
    OR LOWER(form_name) LIKE '%demo%'
    OR LOWER(form_name) LIKE '%component%indexing%'
    OR LOWER(form_name) LIKE '%unlock%'
    OR LOWER(conversion_details) LIKE '%sales%'
    OR LOWER(conversion_details) LIKE '%demo%'
    OR LOWER(conversion_details) LIKE '%component%indexing%'
    OR LOWER(conversion_details) LIKE '%unlock%'
  )
GROUP BY form_name, conversion_details, form_type, form_intent
ORDER BY submission_count DESC
LIMIT 100
`;

    const result = await runQuery(sql);
    return result.rows;
  },
});
