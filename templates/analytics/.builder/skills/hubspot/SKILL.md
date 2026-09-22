---
name: hubspot
description: >
  Query HubSpot CRM for deals, contacts, companies, and sales metrics.
  Use this skill when the user asks about sales pipeline, deal status, or customer CRM data.
---

# HubSpot CRM Integration

## Connection

- **Base URL**: `https://api.hubapi.com`
- **Auth**: `Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN` or legacy
  `HUBSPOT_ACCESS_TOKEN`
- **Env vars**: `HUBSPOT_PRIVATE_APP_TOKEN` preferred,
  `HUBSPOT_ACCESS_TOKEN` legacy
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib

- **File**: `server/lib/hubspot.ts`

### Exported Functions

| Function                                         | Description                          |
| ------------------------------------------------ | ------------------------------------ |
| `getDealPipelines()`                             | All deal pipelines with stages       |
| `getVisiblePipelines(pipelines)`                 | Filter to visible pipelines          |
| `getMetricsPipelines(pipelines)`                 | Filter to metrics-relevant pipelines |
| `getDealProperties()`                            | HubSpot deal property metadata       |
| `getAllDeals(extraProperties?)`                  | All deals (paginated, up to ~10k)    |
| `getDealOwners()`                                | HubSpot owner id → owner name map    |
| `computeSalesMetrics(deals, pipelines, filter?)` | Compute won/lost/pipeline metrics    |

## Script Usage

```bash
# Search deals for a named account/deal
pnpm action hubspot-deals --query="Example Corp" --limit=10 --properties=dealname,amount,dealstage

# Structured cohort: products field = Publish, closed-won New Business deals
pnpm action hubspot-deals --product=Publish --pipeline="New Business" --closedStatus=won --closedDateFrom=2025-06-01 --closedDateTo=2026-06-01

# List deals
pnpm action hubspot-deals --properties=dealname,amount,dealstage

# Find custom fields before requesting them
pnpm action hubspot-deal-properties --search=nbm
```

## Key Patterns & Gotchas

- `getAllDeals` paginates using `limit=100` and HubSpot `after` token (up to 100 pages)
- `hubspot-deals --query="Customer"` uses HubSpot search and should be the first path for named account/deal deep dives. Avoid pulling every deal first.
- For deal cohorts, use structured `hubspot-deals` filters (`product`, `pipeline`, `closedStatus`, `closedDateFrom`, `closedDateTo`) and report the returned filters/count in the methodology.
- Do not use `query` for property-specific filters. `query="Publish"` is broad full-text search across deals and can include records where `products` is not Publish.
- If `hubspot-deals` cannot express the needed CRM endpoint/filter/body/pagination, use `provider-api-catalog --provider=hubspot`, optionally `provider-api-docs`, then `provider-api-request --provider=hubspot` with the exact HubSpot API request.
- `hubspot-deals` returns normalized `stage_name`, `pipeline_name`, `owner_name`, `is_closed_won`, and `is_deal_closed` fields under `deal.properties`
- For AE QBR or NBM deck work, HubSpot is the source of truth. Request `nbm_meeting_booked_date`, `nbm_meeting_complete_date`, and `hs_manual_forecast_category` through `hubspot-deals`; do not use warehouse SQL as the first path unless HubSpot is unavailable and the user approves the fallback
- Optional deal properties are filtered against HubSpot property metadata before fetching, so deployments without a custom field do not fail the whole action
- The default deal fetch includes the hard-coded `hs_v2_date_entered` stage property names with embedded stage IDs when they exist in the connected portal
- `computeSalesMetrics` infers won/lost stages from probability metadata or label text; identifies POV stages by names containing "proof of value", "pov", "poc"
- When looking up a customer, search deals by name, then get associated company via `/crm/v3/objects/deals/{id}/associations/companies`, then contacts via `/crm/v3/objects/companies/{id}/associations/contacts`

## HubSpot Company Properties (BigQuery staging table)

Table: `your-project-id.dbt_staging.hubspot_companies`

- `company_name`, `company_id`, `company_domain_name`
- `upcoming_renewal_date`, `customer_stage`, `hs_csm_sentiment`
- `company_owner_name`, `root_org_id`
- `customer_segmentation`, `current_enterprise_arr`, `company_status`

## Cross-Reference

- HubSpot company → contacts → `dim_hs_contacts.builder_user_id` → BigQuery usage data
- HubSpot deal → company → Pylon support tickets, Gong sales calls
