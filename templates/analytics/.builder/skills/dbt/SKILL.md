# dbt Skill

## Overview

This skill covers two complementary approaches for working with dbt:

1. **dbt MCP tools** — live introspection of the dbt project via `mcp__dbt__*` tools (requires the dbt MCP server to be connected; check `/_agent-native/mcp/status`).
2. **Static reference** — hardcoded table/column/join knowledge compiled here when the MCP server is unavailable.

**Always check the MCP server first.** If the `dbt` server appears in connected servers (`/_agent-native/mcp/status`), use MCP tools to get accurate, live model details before writing SQL.

---

## Setup

### Option A — Local dbt Core (requires uvx)

1. Install [uv](https://docs.astral.sh/uv/): `curl -LsSf https://astral.sh/uv/install.sh | sh`
2. Add to `.env` (analytics template root):
   ```
   DBT_PROJECT_DIR=/absolute/path/to/your/dbt/project
   DBT_PROFILES_DIR=/absolute/path/to/your/dbt/project   # same dir if profiles.yml lives there
   ```
3. The spawned `uvx dbt-mcp` process inherits all env vars from the analytics server process.
4. Restart the analytics dev server — watch for `[mcp-client] connected to dbt: N tools`.

**Disable unused toolsets** (avoids noise for dbt Core users who have no Cloud account):
```
DBT_MCP_DISABLE_DBTCLOUD=true
DBT_MCP_DISABLE_SEMANTIC_LAYER=true
```

### Option B — dbt Cloud (HTTP, no local install needed)

Add the dbt Cloud MCP server via the Analytics app Settings → MCP Servers → Add server:

- **URL**: `https://cloud.getdbt.com/api/mcp/v1/sse`
- **Authorization header**: `Bearer <your-dbt-cloud-service-token>`
- **Scope**: Team (shared) or Personal

The server id will appear as `org_<orgId>_dbt-cloud` or `user_<hash>_dbt-cloud`. Tools are prefixed `mcp__<id>__`.

Alternatively, set the `MCP_SERVERS` env var at deploy time (substitutes the full JSON config including the token):
```
MCP_SERVERS={"servers":{"dbt":{"type":"http","url":"https://cloud.getdbt.com/api/mcp/v1/sse","headers":{"Authorization":"Bearer YOUR_TOKEN"}}}}
```

---

## Available dbt MCP Tools

All tools are prefixed `mcp__dbt__` (local stdio) or `mcp__<scope>_<name>__` (remote HTTP). Use the exact prefixed name when calling them.

### Local CLI Tools (Option A only)

| Tool | When to use |
|---|---|
| `mcp__dbt__list` | List all models, sources, tests, or seeds by type. Pass `--select` for filtering. |
| `mcp__dbt__get_node_details_dev` | Get full details (SQL, columns, description, tags, config) for a specific model from `manifest.json`. |
| `mcp__dbt__get_lineage_dev` | Trace upstream/downstream lineage from a model. `depth=1` for immediate parents/children. |
| `mcp__dbt__compile` | Compile a model's Jinja SQL to raw SQL — useful to see the actual query before running. |
| `mcp__dbt__parse` | Re-parse the project to refresh `manifest.json` after model changes. |
| `mcp__dbt__show` | Run SQL against the warehouse and return sample rows. Use for spot-checking column values. |
| `mcp__dbt__run` | Materialize one or more models. Use sparingly — only when the user explicitly asks. |
| `mcp__dbt__build` | Run + test a selection. Use only when explicitly asked. |

### Discovery API Tools (Option B / dbt Cloud)

| Tool | When to use |
|---|---|
| `mcp__dbt__get_all_models` | List all models with names and descriptions. Good starting point for finding relevant tables. |
| `mcp__dbt__get_all_sources` | List all sources with freshness status. |
| `mcp__dbt__get_all_macros` | List macros — rarely needed for dashboard work. |

### Documentation Tools (both options)

| Tool | When to use |
|---|---|
| `mcp__dbt__search_product_docs` | Search dbt's official documentation at docs.getdbt.com. |
| `mcp__dbt__get_product_doc_pages` | Fetch full content of a specific docs page. |

---

## Workflow: Finding the Right Tables for a Dashboard

**Always follow this sequence before writing any dashboard SQL:**

```
1. mcp__dbt__get_all_models         → scan names + descriptions
2. mcp__dbt__get_node_details_dev   → get exact column names for relevant models
3. mcp__dbt__get_lineage_dev        → understand joins and upstream sources
4. mcp__dbt__compile (optional)     → verify Jinja resolves to expected SQL
5. Write BigQuery SQL using verified table/column names
```

If MCP is unavailable, fall back to the Static Reference section below and query `INFORMATION_SCHEMA.COLUMNS` to verify column names before writing panels.

---

## Project Schema Organization

| Schema | Purpose | Examples |
|---|---|---|
| `dbt_staging_bigquery` | Raw staged events from BigQuery | `first_pageviews`, `all_pageviews`, `signups` |
| `dbt_staging` | Raw staged data from other sources | `hubspot_companies`, `hubspot_contacts` |
| `dbt_intermediate` | Joins, transforms, denormalization | `hubspot_form_submissions`, `deal_first_contact` |
| `dbt_mapping` | Join tables, ID mappings | `hs_deals_to_contact_id`, `user_id_to_org_id` |
| `dbt_mart` | Dimensional models (fact/dim tables) | `dim_hs_deals`, `dim_hs_contacts`, `dim_subscriptions` |
| `dbt_analytics` | Reporting views, aggregates | `deals_by_motion`, `revenue_funnel`, `active_users` |
| `dbt_dev` | Development/testing — **exclude from queries** | Auto-filtered by BigQuery lib |

---

## Static Reference: Key Tables and Columns

Use these when MCP isn't connected. Always verify with `INFORMATION_SCHEMA.COLUMNS` before relying on any column name.

| Table | Key Columns |
|---|---|
| `dbt_staging_bigquery.first_pageviews` | `visitor_id`, `url`, `referrer`, `created_date` (TIMESTAMP), `channel`, `utm_*`, `user_id`, `site_type` |
| `dbt_staging_bigquery.all_pageviews` | `page_type`, `sub_page_type`, `first_touch_channel`, `session_channel`, `c_referrer`, `utm_*` |
| `dbt_staging_bigquery.signups` | `visitor_id`, `user_id`, `root_organization_id`, `utm_*`, `signup_url`, `created_date` |
| `dbt_analytics.product_signups` | `user_id`, `user_create_d` (TIMESTAMP), `channel`, `icp_flag`, `top_subscription`, `referrer`, `utm_*` |
| `dbt_mart.dim_hs_contacts` | `contact_id`, `b_visitor_id`, `builder_user_id`, `ql_score`, `company_fit_score`, `lifecycle_stage_name`, `date_entered_mql/sal/s0/s1` |
| `dbt_mart.dim_deals` | `deal_id`, `amount`, `stage_name` (NOT `deal_stage`), `is_closed_won` (string), `arr_amount`, `close_date`, `create_date` |
| `dbt_mart.dim_subscriptions` | `subscription_id`, `root_id`, `space_id`, `subscription_arr`, `start_date`, `plan`, `status` |

---

## Common Join Paths

```sql
-- Visitor → Signup
first_pageviews.visitor_id = signups.visitor_id

-- Visitor → Contact
first_pageviews.visitor_id = dim_hs_contacts.b_visitor_id

-- Signup → Contact (always match BOTH — prevents false matches from ID reuse)
signups.user_id = dim_hs_contacts.builder_user_id
AND LOWER(signups.email) = LOWER(dim_hs_contacts.email)

-- Signup → Subscription
signups.root_organization_id = dim_subscriptions.root_id

-- Contact → Deal
-- Option 1: via mapping table
dbt_intermediate.hs_deals_to_contact_id (unnests associatedcontactids JSON)
-- Option 2: via lifecycle stage dates on dim_hs_contacts
```

---

## Critical SQL Gotchas

### Column Name Mismatches

| Spec Column | Actual Column | Table |
|---|---|---|
| `first_pageview_date` | `created_date` (TIMESTAMP) | `first_pageviews` |
| `channel` | `first_touch_channel` | `all_pageviews` |
| `referrer` | `c_referrer` | `all_pageviews` |
| `user_create_date` | `user_create_d` (TIMESTAMP) | `product_signups` |
| `deal_stage` | `stage_name` | `dim_hs_deals` / `dim_deals` |
| `deal_amount` | `amount` | `dim_hs_deals` / `dim_deals` |

**Resolution:** Use `mcp__dbt__get_node_details_dev` to get exact column names, or query `INFORMATION_SCHEMA.COLUMNS` before writing panel SQL.

### Type Casting

```sql
-- is_closed_won is STRING 'true'/'false', NOT BOOL
CASE WHEN CAST(is_closed_won AS STRING) = 'true' THEN 1 ELSE 0 END

-- Amounts can be STRING in some tables
SUM(CAST(amount AS FLOAT64))

-- first_pageviews.created_date is TIMESTAMP — wrap date literals:
WHERE created_date >= TIMESTAMP('2025-01-01')
```

### ARRAY_AGG Syntax (BigQuery)

```sql
-- WRONG — DISTINCT + ORDER BY non-argument
ARRAY_AGG(DISTINCT form_name IGNORE NULLS ORDER BY form_fill_date LIMIT 1)

-- CORRECT — remove DISTINCT or order by the aggregated column
ARRAY_AGG(form_name IGNORE NULLS ORDER BY form_fill_date LIMIT 1)[SAFE_OFFSET(0)]
```

### Deduplication with QUALIFY

```sql
SELECT *
FROM table
QUALIFY ROW_NUMBER() OVER (PARTITION BY deal_id ORDER BY created_date) = 1
```

### Email Matching

```sql
-- Always case-insensitive; NULL-safe for visitor IDs
LOWER(a.email) = LOWER(b.email)
OR (a.b_visitor_id IS NOT NULL AND a.b_visitor_id = b.b_visitor_id)
```

---

## Deal Motion Classification (Warm Outbound Detection)

Join `dbt_analytics.product_signups` (match by **both** email AND user_id with OR logic):

```sql
LEFT JOIN `builder-3b0a2.dbt_analytics.product_signups` ps
  ON (
    LOWER(ps.email) = LOWER(c.email)
    OR (ps.user_id IS NOT NULL AND ps.user_id = c.builder_user_id)
  )
  AND ps.user_create_d < d.createdate   -- signed up BEFORE deal was created
```

**Critical**: Use `dbt_analytics.product_signups` not `dbt_staging_bigquery.signups` — the former has complete coverage. `user_create_d` is already TIMESTAMP, no conversion needed.

---

## dbt Model Config Block Reference

```sql
{{
    config(
        schema="dbt_analytics",
        materialized="table",    -- or "view", "incremental"
        tags=["daily", "analytics"],
    )
}}
```

---

## Testing Queries Before Creating dbt Models

1. Write the SQL with fully qualified table names: `` `builder-3b0a2.dbt_mart.dim_hs_deals` ``
2. Run via `pnpm action bigquery --sql "..."` to validate against the real warehouse
3. If it passes, convert to dbt Jinja syntax (`{{ ref("table") }}`)
4. Save to `code/.builder/dbt-models/<model_name>.sql` for the user to deploy

**Do NOT** create files in `dbt/models/` directly — that directory has restricted write access.

---

## Checking MCP Connection Status

```bash
curl /_agent-native/mcp/status
```

Look for `"dbt"` in `connectedServers`. If absent, the dbt MCP server failed to connect — check `errors.dbt` for the reason (usually: uvx not installed, or env vars not set).

---

## When to Update This Skill

Update this skill when you:
- Discover a new column name mismatch or gotcha
- Find a new join pattern between dbt models
- Learn a new dbt MCP tool or flag
- Validate a query template that others would reuse
