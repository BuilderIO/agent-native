import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TABLE_INFO = `## BigQuery Table Info

This generic analytics template does not bundle a workspace-specific BigQuery data dictionary.

Use these sources of truth instead:

- \`list-data-dictionary\` for approved metric, table, column, join, and caveat definitions configured by this organization.
- \`data-source-status --key bigquery\` to confirm whether BigQuery credentials and a project are configured.
- The configured warehouse's \`INFORMATION_SCHEMA.COLUMNS\` tables when you need to discover actual datasets, tables, and columns.
- \`@app_events\` as the placeholder for the configured application events table in query-metrics examples.
- \`@project\` as the configured BigQuery project placeholder for fully-qualified table references.

If no data-dictionary entry exists and schema discovery is unavailable, ask the user for the source table or metric definition before writing SQL. Never invent table names, column names, joins, or numbers.

Example schema discovery query:

\`\`\`sql
SELECT
  table_schema,
  table_name,
  column_name,
  data_type
FROM \`@project.<dataset>.INFORMATION_SCHEMA.COLUMNS\`
WHERE table_name = '<table_name>'
ORDER BY ordinal_position
\`\`\`
`;

export default defineAction({
  description:
    "Explain how to find configured BigQuery table and column metadata without relying on a bundled workspace-specific dictionary.",
  schema: z.object({}),
  http: false,
  run: async () => {
    return TABLE_INFO;
  },
});
