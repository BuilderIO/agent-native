import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

const TABLE_INFO = `## BigQuery Table Info

This generic analytics template does not bundle a workspace-specific BigQuery data dictionary. BigQuery is a warehouse with many datasets and tables; the connection is not represented by one table name.

Use these sources of truth instead:

- \`list-data-dictionary\` for approved metric, table, column, join, and caveat definitions configured by this organization.
- \`data-source-status --key bigquery\` to confirm whether BigQuery credentials and a project are configured.
- \`search-bigquery-schema\` to search the configured project by dataset, table, or column term, or inspect exact table columns before writing SQL.
- The configured warehouse's \`INFORMATION_SCHEMA.COLUMNS\` tables when you need to discover actual datasets, tables, and columns.
- \`@app_events\` as an optional placeholder for a default application events table in query-metrics examples. It defaults to \`<BIGQUERY_PROJECT_ID>.analytics.events_partitioned\` and can be overridden with \`ANALYTICS_BIGQUERY_EVENTS_TABLE\`; it is not the BigQuery connection status or a table catalog.
- \`@project\` as the configured BigQuery project placeholder for fully-qualified table references.

If no data-dictionary entry exists, search the configured project before asking about business meaning. Ask the user for a metric definition only after the configured schema and query actions prove that the source or metric is unavailable. Never ask the user to provide internal dataset, table, or column names that the schema action can discover, and never invent table names, column names, joins, or numbers.

Preferred schema discovery:

\`\`\`bash
pnpm action search-bigquery-schema
pnpm action search-bigquery-schema --dataset=<dataset>
pnpm action search-bigquery-schema --table=<dataset.table>
pnpm action search-bigquery-schema --search=<metric-or-column-term>
\`\`\`

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
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Explain how to find configured BigQuery table and column metadata without relying on a bundled workspace-specific dictionary.",
  schema: z.object({}),
  http: false,
  run: async () => {
    return TABLE_INFO;
  },
});
