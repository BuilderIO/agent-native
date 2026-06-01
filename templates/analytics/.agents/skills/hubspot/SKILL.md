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

- `hubspot-deals` — deals with normalized stage, pipeline, owner, forecast, and
  NBM fields. For a named customer/deal/account, pass `query`; do not fetch all
  deals first.
- `hubspot-records` — generic HubSpot search/list for contacts, companies,
  deals, and tickets. Use this to enrich a deep dive with company, contact, or
  ticket records.
- `hubspot-properties` / `hubspot-deal-properties` — property metadata before
  requesting custom fields.
- `hubspot-pipelines` / `hubspot-metrics` — pipeline definitions and aggregate
  sales metrics.

## Patterns

For account or deal deep dives:

1. Call `data-source-status` if you are not sure HubSpot is connected.
2. Call `hubspot-deals` with `query` set to the company/deal name and a bounded
   `limit`.
3. If the deal result needs more CRM context, call `hubspot-records` for
   `companies`, `contacts`, or `tickets` with the same account name, domain, or
   known email.
4. Cite which records you inspected and keep unsupported associations as caveats.

Example:

```txt
hubspot-deals(query: "The Knot", limit: 10)
hubspot-records(objectType: "companies", query: "The Knot", limit: 5)
hubspot-records(objectType: "contacts", query: "theknot.com", limit: 25)
```

Do not use warehouse copies of HubSpot as a substitute unless the user asks for
the warehouse data or the live HubSpot action is unavailable and the user chooses
that fallback.
