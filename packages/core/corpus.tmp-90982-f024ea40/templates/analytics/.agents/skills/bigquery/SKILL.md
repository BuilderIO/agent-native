---
name: bigquery
description: >-
  Query the configured BigQuery warehouse for analytics data. Use when the user
  asks for warehouse SQL, BigQuery tables, Amplitude-in-BigQuery events, or a
  metric/table that the data dictionary says lives in BigQuery.
---

# BigQuery

## CRITICAL: BigQuery is a Native Agent Tool

**`bigquery` is available directly in the agent's tool list as a native callable tool.**

- If you see `bigquery` in your available tools — **call it directly with your SQL**. Do not use HTTP workarounds, web-request hacks, or scripts as a substitute.
- The `server/lib/bigquery.ts` description below is the _underlying implementation_. It does **not** mean BigQuery is only accessible via terminal commands or scripts.
- **When uncertain if the tool works, call it — don't reason your way to "it won't work".** Empirically test by calling the tool.

## Data-Dictionary-First Discipline

**Before writing any SQL, verify the metric definition and exact table/column names.**

1. Call `list-data-dictionary` with a focused search first; dictionary definitions are loaded on demand rather than injected into every chat request.
2. Use `search-bigquery-schema` to confirm exact dataset, table, and column names.
3. Only write SQL after you know the correct table and columns. Do not guess.

**Why this matters**: column names commonly differ from spec (see "Column Name
Differences" below). Querying the wrong column returns wrong numbers silently.
Confirming with `search-bigquery-schema` or `INFORMATION_SCHEMA.COLUMNS` before
writing the query is always faster than debugging a wrong result.

## Source Of Truth Order

Before writing SQL, use the highest-confidence source available:

1. `list-data-dictionary` with a focused search or department filter.
2. Existing dashboard SQL or saved analyses that already answer the same metric.
3. `search-bigquery-schema` metadata for exact datasets, tables, and columns.
4. A concise user clarification when the business meaning cannot be inferred.

Do not invent dataset, table, or column names. BigQuery is a warehouse, not one
table; `BIGQUERY_PROJECT_ID` is only the default project.

## Table Priority Order (CRITICAL)

**Always prefer dbt tables before raw source tables:**

1. `dbt_mart.*` — first choice for business-level data (deals, contracts, subscriptions, customers, companies).
2. `dbt_analytics.*` — first choice for reporting views and aggregated metrics.
3. `dbt_staging_bigquery.*` — for raw staged data (pageviews, signups) when dbt_mart/analytics don't have it.
4. `dbt_intermediate.*` — for joins/transforms when no mart or analytics table exists.
5. `analytics.*` / `amplitude.*` / raw tables — last resort only, when no dbt equivalent exists.

**Never query raw source tables if a dbt model covers the same data.** dbt models
are deduplicated, tested, and have canonical column names. Raw tables may have
duplicates, schema drift, and inconsistent naming.

**Avoid `dbt_dev.*`** — development schema, excluded globally.

## Always Bound Queries by Date

Always include a date or timestamp filter in any query that touches large event
or pageview tables. Unbounded queries scan full table history, hit byte limits,
and return unusable result sets. Use the most restrictive date range that still
answers the question.

```sql
-- Always add: WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
-- Or for TIMESTAMP columns: WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
```

## Actions

| Action                                  | Use                                                                 |
| --------------------------------------- | ------------------------------------------------------------------- |
| `data-source-status --key bigquery`     | Check whether BigQuery credentials and project are configured.      |
| `list-data-dictionary --search <topic>` | Find canonical metric/table definitions before SQL.                 |
| `search-bigquery-schema`                | List datasets, list tables in a dataset, or describe table columns. |
| `bigquery --sql "<sql>"`                | Run a real warehouse query after table/column names are known.      |

For direct Amplitude/PostHog/Mixpanel product-event data (outside the warehouse
copy), there is no first-class action — call `provider-api-catalog` /
`provider-api-docs` then `provider-api-request` (provider `amplitude`, `posthog`,
or `mixpanel`), and aggregate in `run-code` for corpus-wide event analysis.

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

## Column Name Differences (Common Bug Sources)

| Spec Column           | Actual Column              | Table           |
| --------------------- | -------------------------- | --------------- |
| `first_pageview_date` | `created_date` (TIMESTAMP) | first_pageviews |
| `channel` (pageviews) | `first_touch_channel`      | all_pageviews   |
| `referrer`            | `c_referrer`               | all_pageviews   |
| `referrer_channel`    | `session_channel`          | all_pageviews   |
| `user_create_date`    | `user_create_d`            | product_signups |
| `deal_stage`          | `stage_name`               | dim_deals       |
| `deal_amount`         | `amount`                   | dim_deals       |

Always verify with `search-bigquery-schema` before writing SQL against an unfamiliar table.

## Join Paths — Identity Stitching Rule

**Always match on BOTH a stable id AND email** when joining contacts/users across tables:

```sql
-- CORRECT: both user_id and email
ON signups.user_id = contacts.user_id
AND LOWER(signups.email) = LOWER(contacts.email)

-- WRONG: id alone — IDs can be reassigned or recycled
ON signups.user_id = contacts.user_id
```

IDs can be reassigned after deletes/merges. Email alone over-matches shared addresses.
Require both for exact matches; flag email-only or id-only joins as low-confidence caveats.

## SQL Patterns

### Timestamps vs Dates

- TIMESTAMP columns need `TIMESTAMP('2025-11-01')` comparisons, not date strings.
- DATE columns need `DATE('2025-11-01')`.
- Use `DATE(timestamp_col)` before `DATE_TRUNC` to avoid type mismatch errors.
- Use `QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1`
  for deduplication — cleaner than a subquery.

### Type Casting

- Some warehouse tables store booleans as STRING `'true'`/`'false'` — always
  `CAST(col AS STRING) = 'true'` rather than treating as BOOL.
- Amount/ARR fields may be stored as STRING — `CAST(amount AS FLOAT64)` before
  arithmetic.

### Avoid Double WHERE

```sql
-- WRONG: syntax error
WHERE date BETWEEN '...' AND '...'
WHERE col IS NOT NULL

-- CORRECT: single WHERE with AND
WHERE col IS NOT NULL AND date BETWEEN '...' AND '...'
```
