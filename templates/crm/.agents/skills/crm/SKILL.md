---
name: crm
description: Work with the HubSpot-connected CRM companion using scoped records, field policies, evidence, proposals, and provider data programs.
---

# CRM Companion

Use actions as the operational source of truth and `shared/crm-contract.ts` as
the product-model source of truth. This phase supports HubSpot Connected/Hybrid
behavior only. Salesforce transport and native CRM mode are out of scope.

## Start with the right source

- Use `view-screen` only when the request depends on the current UI view,
  selection, or saved view. Use `get-crm-overview`, `list-crm-records`, and
  `get-crm-record` for ordinary CRM reads.
- Use `sync-crm` for a declared, bounded mirror cohort. It is not an exhaustive
  provider export.
- For an endpoint, object, filter, pagination mode, or schema not represented
  by a CRM action, use `provider-api-catalog`, `provider-api-docs`, then
  `provider-api-request`. For broad work, fetch all relevant pages or state the
  bounded cohort, stage the result, and use `query-staged-dataset` or a data
  program to reduce it. Report provider, scope, filters, page/row counts,
  truncation, and gaps.

## Field, evidence, and credential boundaries

- Credentials exist only in workspace Connections. Never request, paste, log,
  save, or return a HubSpot token or secret.
- Treat upstream HubSpot as authoritative for remote fields. Only configured
  allow-listed fields are mirrored. Unknown fields are remote-only; sensitive
  fields default to redacted and must not be fetched or shown.
- Never save raw provider payloads, media, screenshots, audio, video,
  transcripts, base64 data, or file bodies in CRM SQL. `attach-call-evidence`
  stores only a source URL/id, bounded quote, timestamp, speaker, and metadata.
- Do not identify or merge records by email/domain alone. Provider identity is
  connection + provider + object type + remote id, and relationships retain
  direction.

## Safe writes and workflows

- Use `update-crm-record` for a scoped typed edit. Provider writes are
  revision-aware, access-checked, idempotent, and audited; never claim a
  conflict was applied.
- Agent provider writes default to proposals. For ownership, amount, stage,
  delete, bulk, or external-side-effect changes, show exact scope and fields,
  then require approval. Use `list-crm-proposals` and
  `apply-crm-proposals` to review and apply authorized changes.
- Use `list-crm-saved-views` and `save-crm-saved-view` for saved views. Use
  `list-crm-tasks` and `manage-crm-task` for CRM follow-ups. Use `navigate` to
  show a requested view instead of merely describing it.

## Out of scope

Do not add Salesforce APIs, tokens, schema adapters, or native CRM persistence
in this phase. A Salesforce-shaped contract is intentional compatibility work,
not permission to implement Salesforce.
