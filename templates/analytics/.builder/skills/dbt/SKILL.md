---
name: dbt
description: >
  dbt (data build tool) project structure, SQL patterns, and best practices for the Builder.io analytics warehouse.
  Use this skill when working with dbt models, testing SQL queries, or creating new analytical tables.
---

# dbt Integration

## Project Location

- **Root**: `dbt/` (in workspace root, NOT in code/)
- **Models**: `dbt/models/` organized by layer (staging, intermediate, mart, analytics)
- **Config**: `dbt/dbt_project.yml`
- **Profiles**: `dbt/profiles.yml`

## Access Control

⚠️ **CRITICAL**: The dbt directory has restricted write access. When creating or modifying dbt models:

1. Create SQL in `code/.builder/dbt-models/` first
2. Test the query using a script in `code/scripts/`
3. Validate results before requesting deployment
4. User must manually copy to `dbt/models/` directory

## Schema Organization

| Schema | Purpose | Examples |
|---|---|---|
| `dbt_staging_bigquery` | Raw staged events from BigQuery | `first_pageviews`, `all_pageviews`, `signups` |
| `dbt_staging` | Raw staged data from other sources | `hubspot_companies`, `hubspot_contacts` |
| `dbt_intermediate` | Joins, transforms, denormalization | `hubspot_form_submissions`, `deal_first_contact` |
| `dbt_mapping` | Join tables, ID mappings | `hs_deals_to_contact_id`, `user_id_to_org_id` |
| `dbt_mart` | Dimensional models (fact/dim tables) | `dim_hs_deals`, `dim_hs_contacts`, `dim_subscriptions` |
| `dbt_analytics` | Reporting views, aggregates | `deals_by_motion`, `revenue_funnel`, `active_users` |
| `dbt_dev` | Development/testing (EXCLUDE from queries) | Auto-filtered by BigQuery lib |

## Model Configuration Best Practices

### Standard config block

```sql
{{
    config(
        schema="dbt_analytics",          -- Target schema
        materialized="table",             -- or "view", "incremental"
        tags=["daily", "analytics", "hubspot"],  -- For orchestration/docs
    )
}}
```

### Common materializations

- `table` - Full refresh daily, good for < 10M rows
- `view` - No storage, always fresh, good for simple transforms
- `incremental` - Append-only, for large event tables

## SQL Patterns & Gotchas

### 1. Column Name Mismatches

⚠️ **Common bug source**: Column names differ between spec and actual tables

| Spec Column | Actual Column | Table |
|---|---|---|
| `first_pageview_date` | `created_date` (TIMESTAMP) | `first_pageviews` |
| `channel` | `first_touch_channel` | `all_pageviews` |
| `referrer` | `c_referrer` | `all_pageviews` |
| `user_create_date` | `user_create_d` | `product_signups` |
| `deal_stage` | `stage_name` | `dim_hs_deals` |
| `deal_amount` | `amount` | `dim_hs_deals` |

**Always verify column names** by querying `INFORMATION_SCHEMA.COLUMNS` or reading the source dbt model.

### 2. ARRAY_AGG Syntax

❌ **WRONG** (DISTINCT + ORDER BY non-argument):
```sql
ARRAY_AGG(DISTINCT form_name IGNORE NULLS ORDER BY form_fill_date LIMIT 1)
```

✅ **CORRECT** (remove DISTINCT or order by same column):
```sql
-- Option 1: Remove DISTINCT (ORDER BY creates uniqueness)
ARRAY_AGG(form_name IGNORE NULLS ORDER BY form_fill_date LIMIT 1)[SAFE_OFFSET(0)]

-- Option 2: Order by the aggregated column
ARRAY_AGG(DISTINCT form_name ORDER BY form_name LIMIT 1)[SAFE_OFFSET(0)]
```

### 3. Type Casting

BigQuery dbt models store booleans as strings in some tables. Always cast:

```sql
-- dim_hs_deals.is_closed_won is STRING 'true'/'false', not BOOL
CASE WHEN CAST(is_closed_won AS STRING) = 'true' THEN 1 ELSE 0 END

-- Amounts may be STRING, cast to numeric
SUM(CAST(amount AS FLOAT64))
```

### 4. Email Matching

Always use case-insensitive email matching:

```sql
LOWER(qf.email) = LOWER(c.email)
```

### 5. QUALIFY for Deduplication

Use `QUALIFY` for window function filtering (cleaner than subquery):

```sql
SELECT *
FROM table
QUALIFY ROW_NUMBER() OVER (PARTITION BY deal_id ORDER BY created_date) = 1
```

### 6. NULL-Safe Joins

When joining on potentially NULL columns (like visitor IDs):

```sql
LEFT JOIN forms f
  ON (
    LOWER(f.email) = LOWER(c.email)
    OR (f.b_visitor_id IS NOT NULL AND f.b_visitor_id = c.b_visitor_id)
  )
```

## Common Join Paths

### HubSpot Deals → Contacts → Forms

```sql
FROM {{ ref("dim_hs_deals") }} d
LEFT JOIN {{ ref("hs_deals_to_contact_id") }} dc 
  ON d.deal_id = dc.deal_id
LEFT JOIN {{ ref("dim_hs_contacts") }} c 
  ON dc.contact_id = c.contact_id
LEFT JOIN {{ ref("hubspot_form_submissions") }} f
  ON LOWER(f.email) = LOWER(c.email)
  AND f.form_fill_date < d.createdate
```

**Key points**:
- `hs_deals_to_contact_id` unnests the `associatedcontactids` JSON array
- Multiple contacts per deal → need aggregation or `QUALIFY` to dedupe
- Match contacts to forms by email AND/OR `b_visitor_id`
- Timestamp filter (`form_fill_date < deal.createdate`) for attribution

### Visitor → Signup → Subscription

```sql
FROM {{ ref("first_pageviews") }} fp
LEFT JOIN {{ ref("signups") }} s 
  ON fp.visitor_id = s.visitor_id
LEFT JOIN {{ ref("dim_subscriptions") }} sub
  ON s.root_organization_id = sub.root_id
```

### Contact → User → Organization

```sql
-- Use product_signups for user data
FROM {{ ref("dim_hs_contacts") }} c
LEFT JOIN {{ ref("product_signups") }} ps
  ON LOWER(ps.email) = LOWER(c.email)
  OR (ps.user_id IS NOT NULL AND ps.user_id = c.builder_user_id)
LEFT JOIN {{ ref("dim_root_organizations") }} ro
  ON ps.user_id = ro.user_id -- or use appropriate join key
WHERE ps.user_create_d IS NOT NULL
```

**Important**: Use `dbt_analytics.product_signups` for signup data - it has the most complete user coverage. Match on both email and user_id for best results.

## Testing Queries Before Creating Models

**Always test SQL before creating dbt model**:

1. Create test script in `code/scripts/test-<feature>.sql`
2. Write BigQuery SQL with fully qualified table names:
   ```sql
   FROM `builder-3b0a2.dbt_mart.dim_hs_deals`
   ```
3. Create runner script in `code/scripts/test-<feature>.ts`:
   ```typescript
   import { runQuery } from "../server/lib/bigquery";
   import { readFileSync } from "fs";
   const sql = readFileSync("scripts/test-<feature>.sql", "utf-8");
   const result = await runQuery(sql);
   console.log(result.rows);
   ```
4. Run: `pnpm script test-<feature>`
5. Iterate until results are correct
6. Convert to dbt syntax (replace table names with `{{ ref("table") }}`)
7. Save final SQL to `code/.builder/dbt-models/<model_name>.sql`

## Deal Motion Classification Patterns

### Warm Outbound Detection

To detect if a contact had a product signup before deal creation, use `dbt_analytics.product_signups`:

```sql
-- Join to product_signups (match by email OR user_id)
-- AND signup was BEFORE deal creation
LEFT JOIN {{ ref("product_signups") }} ps
  ON (
    LOWER(ps.email) = LOWER(c.email)
    OR (ps.user_id IS NOT NULL AND ps.user_id = c.builder_user_id)
  )
  AND ps.user_create_d < d.createdate
```

**Key columns in product_signups**:
- `user_id` - Builder user ID
- `email` - User email
- `user_create_d` (TIMESTAMP) - Signup/user creation date

**Critical**: Match on **both email AND user_id** with OR logic for complete coverage. `user_create_d` is already TIMESTAMP, no conversion needed.

**Do NOT** use:
- `dbt_staging_bigquery.signups` - incomplete coverage
- `dim_hs_contacts.sign_up_time_stamp` - DATE type, requires conversion and has gaps

### Form Submission Attribution

When attributing form submissions to deals/contacts:

**Qualifying form categories** (based on actual data analysis):

```sql
WHERE (
  -- Sales-related forms
  LOWER(form_name) LIKE '%sales%'
  OR LOWER(conversion_details) LIKE '%sales%'
  
  -- Demo forms
  OR LOWER(form_name) LIKE '%demo%'
  OR LOWER(conversion_details) LIKE '%demo%'
  
  -- Specific high-intent forms
  OR form_name = '[Marketing]  | Component Indexing Request'
  OR conversion_details = 'Unlock Ent Trial'
)
```

**Common form names** (March 2026 data):
- `[Marketing] Sales Demo Form | 7.20.23` - 5,803 submissions
- `[Marketing] Sales Demo Form - Unlock Enterprise Features` - 3,971 submissions
- `Demo Library Form` - 1,866 submissions
- `[Marketing]  | Component Indexing Request` - 51 submissions

## Model Documentation

Add to `dbt/models/analytics/_models.yml`:

```yaml
- name: deals_inbound_outbound_motion
  description: >
    Classifies Enterprise deals as Inbound or Outbound based on whether 
    any associated contact filled a qualifying form before deal creation.
  columns:
    - name: deal_id
      description: Unique deal identifier
    - name: deal_motion
      description: "Inbound or Outbound classification"
    - name: qualifying_form_count
      description: "Number of distinct qualifying forms filled by associated contacts"
    - name: first_qualifying_form_name
      description: "Name of earliest qualifying form"
```

## Performance Considerations

- **Byte limits**: BigQuery queries have 750GB byte limit
- **Table size**: `dim_hs_deals` ~3,400 rows, `hubspot_form_submissions` ~20K rows
- **Caching**: 24-hour cache in `server/lib/bigquery.ts`
- **Enterprise filter**: Always filter to Enterprise pipelines early in WHERE clause
- **Avoid**: Unnecessary JOINs, avoid SELECT * from large tables

## Useful AI Instructions to Add

Based on this analysis, here are additional AI instructions that would be helpful:

1. **Form submission attribution logic** - Document the exact form categories that qualify as "inbound"
2. **Deal-to-contact join patterns** - The unnesting of `associatedcontactids` is non-obvious
3. **Column name mapping reference** - Centralized list of common mismatches
4. **Type casting patterns** - Which fields need CAST and to what type
5. **Email matching best practices** - Always case-insensitive, NULL-safe for visitor IDs
6. **ARRAY_AGG syntax rules** - DISTINCT + ORDER BY gotcha
7. **QUALIFY usage** - Preferred over subquery for window function filtering
8. **Enterprise pipeline filter** - Standard WHERE clause for enterprise deals
