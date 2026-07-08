---
name: hubspot
description: >-
  Query HubSpot CRM for deals, companies, contacts, tickets, owners, and
  account/deal context.
---

# HubSpot

Use HubSpot for CRM facts: deal status, amount, stage, owner, forecast,
associated account context, contacts, companies, and tickets.

`hubspot-deals` is a legacy-named deal analytics shortcut, not the boundary of
the HubSpot integration. If the user asks for any HubSpot object, endpoint,
association, property, filter, batch read/write, or API version that the typed
actions do not expose, inspect the provider catalog/docs and call
`provider-api-request` with `provider: "hubspot"`.

## Actions

- `account-deep-dive` — first choice for named account/deal deep dives. It
  searches matching HubSpot deals, loads associated companies, contacts,
  tickets, notes, and emails, then pairs that CRM context with Gong evidence.
- `hubspot-deals` — deals with normalized stage, pipeline, owner, forecast, and
  NBM fields. For a named customer/deal/account, pass `query`; do not fetch all
  deals first. For a deal cohort, use structured filters such as `product`,
  `pipeline`, `closedStatus`, `closedDateFrom`, and `closedDateTo`.
- `hubspot-records` — generic HubSpot search/list for contacts, companies,
  deals, and tickets. Use this to enrich a deep dive with company, contact, or
  ticket records.
- `hubspot-pipelines` / `hubspot-metrics` — pipeline definitions and aggregate
  sales metrics.
- For HubSpot **property metadata** (available fields before requesting custom
  ones) there is no first-class action — call `provider-api-request` (provider
  `hubspot`, e.g. `/crm/v3/properties/deals`) via `provider-api-docs`.
- `provider-api-request` with `provider: "hubspot"` — arbitrary HubSpot HTTP
  API calls when first-class actions are too narrow.

## Pipeline Stage Timing — Use Stage-Entry Date Fields

**Always use `hs_v2_date_entered_{stageId}` for deterministic pipeline-stage
timing**, not keyword or amount heuristics:

- Each pipeline stage has a unique numeric ID (visible in pipeline definitions).
- The property `hs_v2_date_entered_{stageId}` records the exact timestamp when
  the deal first entered that stage. Use this to filter deals that reached a
  specific stage within a date window.
- **Why this matters**: heuristic filters (e.g., `amount > $30K`, keyword
  searches) have been found to diverge from stage-date filters by ~48% — nearly
  half the deals are different. Stage-entry date fields provide verifiable,
  auditable results.

To discover stage IDs, call `hubspot-pipelines` first and read the `stageId`
fields in the returned pipeline structure.

Example use: to count deals that reached "Qualified Opportunity" stage in Q1:

```
provider-api-request(
  provider: "hubspot",
  path: "/crm/v3/objects/deals/search",
  method: "POST",
  body: {
    "filterGroups": [{
      "filters": [{
        "propertyName": "hs_v2_date_entered_<stageId>",
        "operator": "BETWEEN",
        "value": "2026-01-01",
        "highValue": "2026-03-31"
      }]
    }],
    "properties": ["dealname", "amount", "hs_v2_date_entered_<stageId>"]
  }
)
```

## Multi-Dimensional Closed-Lost Analysis

**Deals are rarely lost for a single reason.** When analyzing closed-lost deals:

- Use a multi-factor matrix with notation: primary factor (★★), contributing
  factor (★), possible factor (~).
- Track 8-10 common loss factors per deal: Budget, Product Fit, Implementation
  Friction, Competitive Loss, Security/Compliance, Wrong Persona/Champion,
  Timeline Mismatch, Support/Success Gaps, etc.
- Identify combination patterns — e.g., "Product Fit + Implementation Friction"
  may affect multiple deals simultaneously.
- Do not force a single root cause categorization. Real losses are
  multi-dimensional, and flattening to one reason distorts win/loss patterns.
- Report both the count of deals per single factor AND the top multi-factor
  combinations.

## Patterns

For account or deal deep dives:

1. Call `data-source-status` if you are not sure HubSpot is connected.
2. Call `account-deep-dive` with `query` set to the company, domain, deal, or
   opportunity name. Use its associated companies, contacts, tickets, notes, and
   emails as the CRM backbone of the answer.
3. If a specific CRM gap remains, call `hubspot-deals` or `hubspot-records`
   with bounded filters for that missing object only.
4. Cite which records you inspected and keep unsupported associations as caveats.

Example:

```txt
account-deep-dive(query: "The Knot", days: 180, gongLimit: 10, transcriptLimit: 5)
hubspot-deals(query: "The Knot", limit: 10)
hubspot-records(objectType: "companies", query: "theknot.com", limit: 5)
hubspot-records(objectType: "contacts", query: "theknot.com", limit: 25)
```

Do not use warehouse copies of HubSpot as a substitute unless the user asks for
the warehouse data or the live HubSpot action is unavailable and the user chooses
that fallback.

For deal cohorts:

1. Translate the cohort definition into structured `hubspot-deals` filters.
   Example: "new business deals where products field is Publish, closed won in
   the last 12 months" means `product: "Publish"`, `pipeline: "New Business"`,
   `closedStatus: "won"`, and explicit close-date bounds.
2. Do not use `query` for property-specific filters. `query: "Publish"` is a
   broad HubSpot search across deal text and can include unrelated deals.
3. Report the cohort count, filters, and date window before synthesizing. If the
   count looks too low, inspect deal property metadata
   (`/crm/v3/properties/deals`) or use stage-entry date fields via
   `provider-api-request`.
4. When pairing a cohort with Gong, use returned deal/company/contact evidence
   to run bounded Gong follow-ups and state Gong coverage separately from the
   HubSpot cohort size.

If `hubspot-deals` still cannot express the needed HubSpot query, do not stop
or approximate. Call `provider-api-catalog(provider: "hubspot")`, fetch the
HubSpot docs/spec with `provider-api-docs` if needed, then call
`provider-api-request(provider: "hubspot", ...)` with the exact CRM endpoint,
filters, properties, associations, and pagination body.
