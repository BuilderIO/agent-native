---
name: hubspot
description: >
  Query HubSpot CRM for deals, contacts, companies, and sales metrics.
  Use this skill when the user asks about sales pipeline, deal status, or customer CRM data.
---

# HubSpot CRM Integration

## Connection

- **Base URL**: `https://api.hubapi.com`
- **Auth**: `Authorization: Bearer $HUBSPOT_ACCESS_TOKEN`
- **Env vars**: `HUBSPOT_ACCESS_TOKEN`
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib

- **File**: `server/lib/hubspot.ts`

### Exported Functions

| Function | Description |
|---|---|
| `getDealPipelines()` | All deal pipelines with stages |
| `getVisiblePipelines(pipelines)` | Filter to visible pipelines |
| `getMetricsPipelines(pipelines)` | Filter to metrics-relevant pipelines |
| `getAllDeals()` | All deals (paginated, up to ~10k) |
| `computeSalesMetrics(deals, pipelines, filter?)` | Compute won/lost/pipeline metrics |

## Script Usage

```bash
# List deals
pnpm script hubspot-deals --fields=dealname,amount,stageLabel

# Search for a specific customer
pnpm script hubspot-deals --grep="Macy's" --fields=dealname,amount,stageLabel
```

## Key Patterns & Gotchas

- `getAllDeals` paginates using `limit=100` and HubSpot `after` token (up to 100 pages)
- `DEAL_PROPERTIES` includes hard-coded `hs_v2_date_entered` stage property names with embedded stage IDs
- `computeSalesMetrics` infers won/lost stages from probability metadata or label text; identifies POV stages by names containing "proof of value", "pov", "poc"
- When looking up a customer, search deals by name, then get associated company via `/crm/v3/objects/deals/{id}/associations/companies`, then contacts via `/crm/v3/objects/companies/{id}/associations/contacts`

## HubSpot Company Properties (BigQuery staging table)

Table: `builder-3b0a2.dbt_staging.hubspot_companies`
- `company_name`, `company_id`, `company_domain_name`
- `upcoming_renewal_date`, `customer_stage`, `hs_csm_sentiment`
- `company_owner_name`, `root_org_id`
- `customer_segmentation`, `current_enterprise_arr`, `company_status`

## Cross-Reference

- HubSpot company → contacts → `dim_hs_contacts.builder_user_id` → BigQuery usage data
- HubSpot deal → company → Pylon support tickets, Gong sales calls
