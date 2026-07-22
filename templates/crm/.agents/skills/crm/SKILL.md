---
name: crm
description: Work with Native SQL or HubSpot/Salesforce CRM using scoped records, field policies, evidence, proposals, and provider data programs.
---

# CRM Companion

Use actions as the operational source of truth and `shared/crm-contract.ts` as
the product-model source of truth. This scope supports standalone Native SQL
and HubSpot/Salesforce Connected/Hybrid behavior.

## Start with the right source

- Use `view-screen` only when the request depends on the current UI view,
  selection, or saved view. Use `get-crm-overview`, `list-crm-records`, and
  `get-crm-record` for ordinary CRM reads.
- Use `sync-crm` for a declared, bounded mirror cohort. It is not an exhaustive
  provider export.
- Use `configure-native-crm` to start CRM without an external provider. Native
  SQL records are local-authoritative and portable across SQLite, Postgres, and
  D1. Use the normal CRM record, task, view, cadence, and evidence actions;
  never require a provider connection or call `sync-crm` for Native SQL.
- After HubSpot or Salesforce is authorized in workspace Connections, use
  `configure-crm-connection` with the selected provider to register it with
  CRM. Never pass a token. HubSpot starts with `companies`, `contacts`, and
  `deals`; Salesforce starts with `Account`, `Contact`, and `Opportunity`.
- Use `sync-crm` only for the declared recent cohort. HubSpot may be narrowed
  by deal pipeline ids; Salesforce uses the updated-after boundary for its
  standard objects. Record detail can perform a scoped read-through refresh;
  do not treat it as permission for an export-all query.
- For an endpoint, object, filter, pagination mode, or schema not represented
  by a CRM action, use `provider-api-catalog`, `provider-api-docs`, then the
  read-only `provider-api-request` for the selected provider. Before broad work,
  declare a cohort, selected fields, and a bounded page/row budget. Stage only
  that result, then use `query-staged-dataset` or a data program to reduce it.
  Report provider, scope, filters, page/row counts, truncation, and gaps.
- Always pass the selected workspace `connectionId` for Salesforce provider API
  reads so its actor-bound OAuth token and instance URL cannot be separated.

## Field, evidence, and credential boundaries

- Credentials exist only in workspace Connections. Never request, paste, log,
  save, or return a HubSpot or Salesforce token or secret.
- Treat the upstream CRM as authoritative for remote fields. Only configured
  allow-listed fields are mirrored. Unknown fields are remote-only; sensitive
  fields default to redacted and must not be fetched or shown.
- Salesforce reads must be revalidated against the current connection actor and
  field permissions. Never infer a user's access from a service-account mirror
  or from a previously visible local row; fail closed when access is ambiguous.
- Never save raw provider payloads, media, screenshots, audio, video,
  transcripts, base64 data, or file bodies in CRM SQL. `attach-call-evidence`
  stores only a source URL/id, bounded quote, timestamp, speaker, and metadata.
- Use `run-crm-signal-trackers` only over evidence already attached to the CRM
  record. Keyword hits are deterministic. Smart detector and summary requests
  must go through agent chat, never a direct model call. Persist delegated
  results with `record-crm-smart-signal` or one atomic
  `record-crm-call-insight` batch; each quote/timestamp must cite the exact
  bounded evidence row. Use `review-crm-signal` for human confirmation.
- Use `create-crm-signal-tracker` to add a keyword or smart tracker, and
  `manage-crm-signal-tracker` to enable, disable, or delete one tracker with
  editor access. Tracker management is local configuration only: it never
  invokes a model or mutates a connected provider. Navigate with
  `{ view: "settings", settingsSection: "intelligence" }` to open the
  Intelligence settings tab.
- Do not identify or merge records by email/domain alone. Provider identity is
  connection + provider + object type + remote id, and relationships retain
  direction.

## Safe writes and workflows

- Use `update-crm-record` for a scoped typed edit. Provider writes are
  prepared as revision-aware, access-checked, idempotent, audited proposals.
  HubSpot proposals always hand off because HubSpot cannot apply the expected
  revision atomically. Salesforce conditional-write capability is a
  prerequisite for a future provider apply, not a reason to claim a write
  succeeded without a confirmed provider response and the stored approval
  policy.
- Agent provider writes default to proposals. For ownership, amount, stage,
  delete, bulk, or external-side-effect changes, show exact scope and fields,
  then require approval. Use `list-crm-proposals` and
  `apply-crm-proposals` to review the change and record the upstream handoff;
  direct the user to complete it in HubSpot or Salesforce and never claim it
  was applied without a confirmed adapter result.
- Native SQL writes are local-authoritative CRM mutations. They remain
  access-checked, idempotent, and audited, but have no provider handoff or
  remote revision to claim.
- Use `list-crm-saved-views` and `save-crm-saved-view` for saved views. Use
  `list-crm-tasks` and `manage-crm-task` for CRM follow-ups. Use `navigate` to
  show a requested view instead of merely describing it.
- Use `install-crm-pipeline-dashboard` to install the owner-scoped Pipeline
  dashboard. Its stored data program calls the bounded, access-scoped
  `get-crm-pipeline-data` action through `appAction`; do not reimplement the
  aggregate with a provider request or put CRM rows in dashboard config. Use
  `get-crm-dashboard` / `list-crm-dashboards` to inspect dashboards,
  `save-crm-dashboard` with `expectedUpdatedAt` for safe edits, and
  `list-crm-dashboard-revisions` / `restore-crm-dashboard-revision` to review
  or restore prior dashboard configurations.

## Four-area provider changes

Provider behavior must stay aligned across setup UI, CRM actions, this skill,
and `application_state`/`view-screen`. Reuse workspace Connections and action
hooks; do not add a provider-key field, legacy `/api` route, direct browser
fetch, or provider-specific state outside the shared CRM contract.

## Out of scope

Do not add provider migration, a page builder, or raw provider payload/media in
CRM SQL. Native SQL supports the canonical CRM objects and generic custom
records; a separate object-authoring engine is not part of this template.
