---
name: provider-api-scans
description: >-
  Call raw Gmail, Google Calendar, or HubSpot endpoints through
  provider-api-catalog / provider-api-docs / provider-api-request, and stage
  large result sets with stageAs plus query-staged-dataset. Use when a canned
  Mail action lacks the exact endpoint, filter, pagination, or API version, or
  when scanning/aggregating many messages.
---

# Provider API and Staged Scans

## Rule

Treat provider-specific actions as shortcuts, not capability limits. When the
exact Gmail, Google Calendar, or HubSpot endpoint/filter/pagination/API
version matters, use `provider-api-catalog`, `provider-api-docs`, and
`provider-api-request` against the real provider API.

## Staging large scans

For large scans, stage results with `stageAs` and analyze them with
`query-staged-dataset` (`list-staged-datasets` / `delete-staged-dataset`
manage the scratch rows). Staging keeps big provider payloads out of the
conversation: pass ids, counts, and bounded summaries instead of pasting raw
dumps.

## What Mail can reach

Mail's catalog resolves to `gmail`, `google_calendar`, and `hubspot` only
(`MAIL_PROVIDER_API_IDS` / `listProviderApiIdsForTemplateUse("mail")` in
`server/lib/provider-api.ts`). Gong, Pylon, and Apollo are not reachable
through `provider-api-request` in this app — see `contacts-and-crm`.

## Related Skills

- `contacts-and-crm` — which CRM providers are agent-reachable in Mail.
- `inbox-reads-and-triage` — prefer the canned read actions when they already
  express the query.
