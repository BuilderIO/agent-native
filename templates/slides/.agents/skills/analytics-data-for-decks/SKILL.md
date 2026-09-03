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

- Use `call-agent` with `agent: "analytics"` and a natural-language `message`
  by default. Describe the business question, requested window or cohort, and
  the concise result shape the deck needs. Analytics decides which sources,
  tools, queries, and joins answer it.
- A direct `action` + `input` call is optional only when an exact bounded
  semantic read and its complete schema are already known. It is not a fallback
  for slow, failed, or unavailable agent delegation. Never invent an Analytics
  action contract to make a demo pass.
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
