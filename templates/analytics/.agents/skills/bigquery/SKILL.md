---
name: bigquery
description: >-
  Query the configured BigQuery warehouse for analytics data. Use when the user
  asks for warehouse SQL, BigQuery tables, Amplitude-in-BigQuery events, or a
  metric/table that the data dictionary says lives in BigQuery.
---

# BigQuery

## Source Of Truth Order

Before writing SQL, use the highest-confidence source available:

1. The injected `<data-dictionary>` block and `list-data-dictionary`.
2. Existing dashboard SQL or saved analyses that already answer the same metric.
3. `search-bigquery-schema` metadata for exact datasets, tables, and columns.
4. A concise user clarification when the business meaning cannot be inferred.

Do not invent dataset, table, or column names. BigQuery is a warehouse, not one
table; `BIGQUERY_PROJECT_ID` is only the default project.

## Actions

| Action | Use |
| --- | --- |
| `data-source-status --key bigquery` | Check whether BigQuery credentials and project are configured. |
| `list-data-dictionary --search <topic>` | Find canonical metric/table definitions before SQL. |
| `search-bigquery-schema` | List datasets, list tables in a dataset, or describe table columns. |
| `bigquery --sql "<sql>"` | Run a real warehouse query after table/column names are known. |
| `top-amplitude-events --days N` | Inspect common Amplitude event names when the deployment uses the default product-events layout. |

## Schema Discovery

Use `search-bigquery-schema` instead of asking the user to manually print field
lists:

```bash
pnpm action search-bigquery-schema
pnpm action search-bigquery-schema --dataset=product_events
pnpm action search-bigquery-schema --table=product_events.events
pnpm action search-bigquery-schema --dataset=product_events --search=rootOrganizationId
```

When describing a table, copy exact field names from the action result. If a
field has a nested path such as `event_properties.rootOrganizationId`, use the
proper BigQuery JSON or STRUCT access pattern for that field type.

## Dictionary Trust

Approved dictionary entries are canonical. Human-authored but unreviewed
entries are usable with light verification. AI-generated unapproved entries are
suggestions only: verify the table and columns with `search-bigquery-schema` and
prefer saving a reviewed dictionary update once the meaning is clear.

## Common Patterns

- Use `@project.dataset.table` when you want the configured project placeholder.
- Use `@app_events` only for the optional app-events table; it is not the whole
  warehouse and it is not a connection-status signal.
- For metrics or dashboard panels, run at least one real data query before
  presenting numbers.
- An unknown table or column error is a normal, recoverable signal — not a
  stopping point. Use `search-bigquery-schema` (or `INFORMATION_SCHEMA`) to get
  the exact datasets, tables, and columns, correct the query based on the
  error, and run it again. Iterate until it succeeds or you have made a few
  corrective attempts; only surface to the user if it still fails or the error
  is non-recoverable (missing credentials, permission, quota).
