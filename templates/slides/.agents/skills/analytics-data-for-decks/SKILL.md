---
name: analytics-data-for-decks
description: >-
  Route customer, account, CRM, HubSpot, pipeline, renewal, usage, product
  activity, Gong, and other analytics-backed deck requests through the
  Analytics agent. Use when generating or updating Slides content that needs
  external or first-party data.
---

# Analytics data for decks

When a deck needs customer or product data, ask the Analytics agent over A2A
before creating or changing Slides content. The user's wording can be direct,
such as "ask the analytics agent to ...", or implicit in a request for customer,
account, CRM, HubSpot, pipeline, renewal, usage, product-activity, Gong, or
other analytics data.

## Delegation

- For a known, read-only operation, use `call-agent` with `agent: "analytics"`,
  the exact `action`, and complete `input`. This invokes Analytics directly
  without starting a second model loop.
- For ambiguous, multi-source, or narrative questions, use `call-agent` with a
  natural-language `message` and let Analytics decide which source or sources
  to use.
- Useful Analytics operations include `hubspot-records` for bounded CRM
  records and `hubspot-deals` for pipeline and deal metrics,
  `account-deep-dive` for a named account or renewal/risk review, `gong-calls`
  for quotes/counts/transcripts and coverage, and `gong-native-insights` for
  bounded narrative synthesis. For first-party product activity, send a
  natural-language message and let Analytics choose its query.
- Slides must not write SQL, choose a warehouse or provider, call HubSpot/Gong
  directly, or interpret a provider schema itself. Analytics owns source
  selection, data dictionary interpretation, filters, joins, and query
  execution using its own instructions and connected-source status.

## Evidence and deck behavior

- Preserve the question, source, filters, date window, coverage, counts,
  pagination, and limitations from Analytics. Never invent customer data or
  claim a lookup succeeded when it failed.
- If a source is unavailable, name the missing source and continue only with
  clearly labeled data that Analytics actually returned. Do not expose
  credentials or raw provider payloads.
- Before generation, call `get-workspace-defaults` when no reference deck or
  design system is named, then follow `creative-context` for approved brand
  context and provenance. For updates, preserve the existing deck structure
  and make focused slide edits.
