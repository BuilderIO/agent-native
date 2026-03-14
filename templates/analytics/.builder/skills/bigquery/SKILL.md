---
name: bigquery
description: >
  Query BigQuery for analytics events, signups, pageviews, subscriptions, and user data.
  Use this skill when the user asks about metrics, funnels, user activity, or customer usage data.
---

# BigQuery Integration

## Connection

- **Client**: `@google-cloud/bigquery` Node.js client
- **Auth**: `GOOGLE_APPLICATION_CREDENTIALS_JSON` env var (JSON credentials string), falls back to Application Default Credentials
- **Project**: `BIGQUERY_PROJECT_ID` env var, defaults to `builder-3b0a2`
- **Caching**: 24-hour in-memory cache (sha256 of SQL), max 200 entries
- **Byte limit**: `maximumBytesBilled: 750GB` per query

## Server Lib

- **File**: `server/lib/bigquery.ts`
- **Key export**: `runQuery(sql: string): Promise<QueryResult>`
- **Return type**: `{ rows, totalRows, schema, bytesProcessed, cached? }` — **NOT an array**, always access `.rows`
- **Placeholder**: `@app_events` resolves to `analytics.events_partitioned` (fully qualified)

## General Table Usage Guidelines

**Always use these canonical tables for specific use cases:**

| Use Case | Table to Use | Key Columns | Notes |
|---|---|---|---|
| Customer contracts | ```dbt_mart.dim_contracts``` | contract_id, company_id, start_date, end_date, contract_value, status | Canonical source for all contract data |
| HubSpot deals | ```dbt_mart.dim_deals``` | deal_id, amount, stage_name, is_closed_won, close_date | NOT `deal_amount` or `deal_stage` |
| Active subscriptions | ```dbt_mart.dim_subscriptions``` | subscription_id, root_id, plan, status, subscription_arr | Filter `status = 'active'` |
| Enterprise customers | ```dbt_mart.enterprise_companies``` | Joins hubspot_companies + dim_contracts + organizations | Has health_status, renewal dates |
| ARR | ``finance.arr_revenue_tracker_latest`` | unique_id, product, plan, status, arr_change, event_date | arr changes on unique id level |
| All Traffic | ```dbt_staging_bigquery.all_pageviews``` |  |  |

**Schema preferences:**
- Use `dbt_mart.*` for business-level queries (deals, contracts, subscriptions, customers)
- Use `dbt_staging_bigquery.*` for raw event data (pageviews, signups)
- Use `dbt_analytics.*` for reporting views
- **Avoid `dbt_dev.*`** - development schema excluded globally


## Table Map

| Logical Name | Actual Table | Key Columns |
|---|---|---|
| First pageviews | `dbt_staging_bigquery.first_pageviews` | visitor_id, url, referrer, created_date (TIMESTAMP), channel, utm_*, user_id. **No page_type** — derive from URL. |
| All pageviews | `dbt_staging_bigquery.all_pageviews` | Has `page_type`, `sub_page_type`, `first_touch_channel`, `session_channel`, `c_referrer`, full utm fields |
| Signups | `dbt_staging_bigquery.signups` | visitor_id, user_id, root_organization_id, utm_*, signup_url, created_date |
| Signups (enriched) | `dbt_analytics.product_signups` | user_id, user_create_d (TIMESTAMP), channel, icp_flag, top_subscription, referrer, utm_* |
| Blog metadata | `sigma_materialized.SIGDS_82deb8e2_40f8_4fb4_b3cb_caa011a72d29` | Cryptic column names — see mapping below. 858 rows, deduplicate by blog slug. |
| Blog content (old) | `test.builder_blog_content` | contentId, name (blog TITLE not author), handle, topic. Only 75 rows, no author. **DO NOT use for author data.** |
| CRM contacts | `dbt_mart.dim_hs_contacts` | contact_id (INT64), b_visitor_id, builder_user_id, ql_score, date_entered_mql/sal/s0/s1, lifecycle_stage_name |
| Deals | `dbt_mart.dim_deals` | deal_id, amount (not deal_amount), stage_name (not deal_stage), is_closed_won (string), arr_amount, close_date, create_date |
| Subscriptions | `dbt_mart.dim_subscriptions` | subscription_id, root_id, space_id, subscription_arr, start_date, plan, status |
| Enterprise companies | `dbt_mart.enterprise_companies` | Joins hubspot_companies + dim_contracts + organizations. Has upcoming_renewal_date, health_status, customer_stage. |
| HubSpot companies | `dbt_staging.hubspot_companies` | company_name, company_id, company_domain_name, upcoming_renewal_date, root_org_id, current_enterprise_arr |

### Sigma Blog Metadata Column Mapping

| Cryptic Column | Meaning | Example Values |
|---|---|---|
| `SUOHFYGIOG` | Blog URL | `https://www.builder.io/blog/mcp-apps` |
| `H5YIATNDT5` | Author | Alice Moore, Steve Sewell, Matt Abrams, Apoorva, Vishwas Gopinath |
| `ZZJ6XRJAII` | Publish date (TIMESTAMP) | |
| `FTRKLGZM1R` | Purpose | Acquisition, Awareness |
| `IFHWPU1IDO` | Persona | Developers, Product Managers, Engineering Leaders, Designers |
| `Z52LFY52AK` | Topic | AI, CMS, Web Development, Design |
| `_DGCBJNKLE` | Sub-type | Tooling, Development, Prototyping |
| `JQL-G1QE-B` | Sub-topic | AI Design, AI Prototyping, AI Tools |

**Deduplication**: Table has duplicates (http:// vs https://). Always deduplicate: `REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)')` with ROW_NUMBER or DISTINCT.

### Column Name Differences (bug sources)

| Spec Column | Actual Column | Table |
|---|---|---|
| `first_pageview_date` | `created_date` (TIMESTAMP) | first_pageviews |
| `channel` (pageviews) | `first_touch_channel` | all_pageviews |
| `referrer` | `c_referrer` | all_pageviews |
| `referrer_channel` | `session_channel` | all_pageviews |
| `user_create_date` | `user_create_d` | product_signups |
| `deal_stage` | `stage_name` | dim_deals |
| `deal_amount` | `amount` | dim_deals |
| `visitor_id` → contacts | `b_visitor_id` | dim_hs_contacts |
| `user_id` → contacts | `builder_user_id` | dim_hs_contacts |

### Join Paths

- **Visitor → Signup**: `first_pageviews.visitor_id = signups.visitor_id`
- **Visitor → Contact**: `first_pageviews.visitor_id = dim_hs_contacts.b_visitor_id`
- **Signup → Contact**: **CRITICAL: Match on BOTH user_id AND email**
  ```sql
  signups.user_id = dim_hs_contacts.builder_user_id
  AND signups.email = dim_hs_contacts.email
  ```
  Matching on both prevents mismatches from reassigned user IDs or data sync issues.
- **Signup → Subscription**: `signups.root_organization_id = dim_subscriptions.root_id`
- **Contact → Deal**: No direct FK. Use `dbt_intermediate.deal_first_contact` or lifecycle stage dates on dim_hs_contacts.
- **Blog → Author**: `builder_blog_content.contentId = content_with_models.content_id` → `dim_users.name`

### Datasets Overview

`dbt_staging_bigquery` (raw staged), `dbt_analytics` (reporting views), `dbt_mart` (dimensional models), `dbt_intermediate` (joins/transforms), `analytics` (raw events), `finance` (ARR tracking), `sigma_materialized` (Sigma-generated views with UUID names).

## SQL Patterns

### Deriving page_type from URL

```sql
CASE
  WHEN url LIKE '%/blog/%' THEN 'blog'
  WHEN url LIKE '%/docs/%' THEN 'docs'
  WHEN REGEXP_CONTAINS(url, r'builder\.io/?(?:\?|$)') THEN 'marketing'
  WHEN url LIKE '%/sign-up%' THEN 'webapp'
  ELSE 'other'
END
```

### Timestamps vs Dates

- `first_pageviews.created_date` is TIMESTAMP — wrap: `TIMESTAMP('2025-11-01')`
- `product_signups.user_create_d` is TIMESTAMP — same
- `dim_hs_contacts.sign_up_time_stamp` is DATE — no wrapping
- Use `DATE(timestamp_col)` before `DATE_TRUNC` to avoid type mismatch

### Avoid double WHERE

```sql
-- WRONG
WHERE date BETWEEN '...' AND '...'
WHERE col IS NOT NULL

-- CORRECT
WHERE col IS NOT NULL AND date BETWEEN '...' AND '...'
```

## Analytics Events (Amplitude)

### Event column vs Name column

Fusion events use `event` column, NOT `name` column (often NULL). Use `event = 'fusion chat message submitted'`.

### Preferred table for Fusion events

Use **Amplitude** (`amplitude.EVENTS_182198`) instead of `@app_events` — smaller, stays within byte limits:
- Use `event_type` (not `event`) and `event_time` (not `createdDate`)
- `rootOrganizationId` and `organizationId` in `event_properties` JSON
- `builderSpaceId` is NULL for fusion events
- Always use `capTo30Days()` helper for Amplitude time series

### Enterprise customer identification

- `data.isEnterpriseCompany` is **unreliable** — most enterprise events have it false/missing
- **Preferred**: JOIN to `dim_subscriptions` on rootOrganizationId, filter `LOWER(plan) = 'enterprise' AND status = 'active'`

### Key Fusion event types

| Event | Description |
|---|---|
| `fusion chat message submitted` | User sends message in Fusion/Projects AI |
| `visual editor ai chat message submitted` | User sends message in Visual Editor AI |
| `fusion chat message completed` | AI response completed |
| `fusion code applied` | User applied generated code |

### Customer Fusion message lookup pipeline

1. HubSpot deal → company → contacts
2. `dim_hs_contacts` (contact_id is INT64) → `builder_user_id`
3. `signups` → `root_organization_id`
4. Amplitude events WHERE `JSON_VALUE(event_properties, '$.rootOrganizationId') IN (...)`
5. **Always filter out `@builder.io` emails** — Builder SEs show up in customer org events

## Dashboard Data Fetching (CRITICAL)

**NEVER use scripts for dashboard UI data.** Use `useMetricsQuery(queryKey, sql)` with direct BigQuery SQL:
- Define SQL in `queries.ts` alongside the dashboard
- Queries go through authenticated `/api/query` endpoint
- For customer lookups, use CTEs with JOINs to `dim_hs_contacts`
- **Scripts are for CLI/agent use only**
