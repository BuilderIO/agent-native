---
name: hubspot
description: >-
  Query HubSpot CRM for deals, companies, contacts, tickets, owners, and
  account/deal context.
---

# HubSpot

Use HubSpot for CRM facts: deal status, amount, stage, owner, forecast,
associated account context, contacts, companies, and tickets.

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
- `hubspot-properties` / `hubspot-deal-properties` — property metadata before
  requesting custom fields.
- `hubspot-pipelines` / `hubspot-metrics` — pipeline definitions and aggregate
  sales metrics.
- `provider-api-request` with `provider: "hubspot"` — arbitrary HubSpot HTTP
  API calls when first-class actions are too narrow. Use this for unsupported
  CRM object types, association endpoints, custom search filters, batch APIs,
  pagination modes, or any HubSpot endpoint not represented by a typed action.

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
hubspot-records(objectType: "companies", query: "The Knot", limit: 5)
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
   broad HubSpot search across deal text and can include deals where
   `products = Develop` just because "Publish" appeared somewhere else.
3. Report the cohort count, filters, and date window before synthesizing. If the
   count looks too low, inspect `hubspot-deal-properties` or adjust the
   structured filters; do not silently broaden to keyword search.
4. When pairing a cohort with Gong, use the returned deal/company/contact
   evidence to run bounded Gong follow-ups and state Gong coverage separately
   from the HubSpot cohort size.

If `hubspot-deals` still cannot express the needed HubSpot query, do not stop
or approximate. Call `provider-api-catalog(provider: "hubspot")`, fetch the
HubSpot docs/spec with `provider-api-docs` if needed, then call
`provider-api-request(provider: "hubspot", ...)` with the exact CRM endpoint,
filters, properties, associations, and pagination body.
