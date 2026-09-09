# CRM — Agent Guide

A typed, bitemporal CRM whose grid is the product. It is Native SQL or a scoped
HubSpot/Salesforce lens; UI and agent share actions.

## Skills

- `crm` — read before CRM work: provider/credential boundaries, lists,
  enrichment, signals, dashboards, and Clips evidence.

## Core model

- **Typed attributes**, 17 types, two of them system-only (interaction and
  personal-name). Call `list-crm-attributes` first; never guess a slug or type.
- **Managed options.** A status/select value must already exist as an option;
  writing an unknown one is a 422, never a silent auto-create.
- **Values are bitemporal.** A change closes the current row and opens a new
  one, so stage history *is* the value history. An equal write stores nothing;
  `historyTracked=false` means in-place updates, not "never changed".
- **Objects vs lists.** A list is a workflow overlay over one object type, with
  its own entry attributes. Lists and their entries are local-authoritative on
  *every* backend, HubSpot and Salesforce included — a pipeline never needs a
  provider write.
- **Saved views** hold filter, sort, columns, audience, and a table or board
  presentation; `"@currentUser"` in a filter resolves to the caller.
- **Enrichment spends in two phases**: free `verify`, then paid `spend` whose
  input set is *built from* approved record ids.

## Hard boundaries

- Workspace Connections own provider credentials. Never request, store, log, or
  return a provider token.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- The mirror is thin: unknown fields are remote-only, sensitive ones redacted,
  only allow-listed fields mirrored. Raw payloads, transcripts, media, and
  base64 never enter SQL — evidence is a URL/id plus a bounded quote.
- **A provider write is a handoff, not a write.** A provider-owned edit becomes a
  proposal; `apply-crm-proposals` returns the exact diff and a deep link to
  finish it upstream. CRM never completes an upstream write and never reports
  one as applied.
- Ownership, amount, stage, deletion, bulk scope, and external side effects need
  an exact preview and approval.
- Never merge identities from email or domain alone — that is a duplicate
  *signal*; merging is an explicit reviewed action.

## Actions

|Action|Purpose|
|---|---|
|`get-crm-workspace` / `get-crm-overview`|Start here: identity, book of business, tasks, proposals, signals, health.|
|`view-screen` / `navigate`|Read the visible screen and selection; move the UI.|
|`configure-native-crm` / `configure-crm-connection` / `list-crm-connections` / `list-workspace-connections` / `sync-crm`|Set up Native SQL or a granted connection; refresh a cohort.|
|`list-crm-attributes` / `create-crm-attribute` / `update-crm-attribute` / `archive-crm-attribute` / `manage-crm-attribute-option`|Read and author the typed schema and its managed options.|
|`list-crm-records` / `list-crm-record-values` / `get-crm-record` / `get-crm-record-page` / `create-crm-record` / `update-crm-record`|Grid rows, grid cells, one record, the record page, create, edit.|
|`list-crm-record-field-history`|How one value changed: value, the window it was current, actor.|
|`list-crm-lists` / `create-crm-list` / `update-crm-list` / `list-crm-list-entries` / `add-crm-record-to-list` / `update-crm-list-entry` / `remove-crm-list-entry`|Lists and pipelines; a stage move is `update-crm-list-entry`.|
|`list-crm-saved-views` / `save-crm-saved-view` / `delete-crm-saved-view` / `run-crm-saved-view-program`|Saved table/board views and a view's data program.|
|`list-crm-proposals` / `apply-crm-proposals`|Review a pending provider change and record the handoff.|
|`find-crm-duplicates` / `merge-crm-records`|Scored duplicate candidates with reasons; merge into a survivor.|
|`list-crm-enrichment-slots` / `estimate-crm-enrichment` / `run-crm-enrichment`|Slot credential state; cost estimate; the gated verify/spend run.|
|`run-crm-attribute-fill`|Manual fill: get the brief, reason, call again with values.|
|`list-crm-tasks` / `manage-crm-task`|Read and manage follow-up tasks.|
|`attach-call-evidence` / `create-crm-signal-tracker` / `list-crm-signal-trackers` / `manage-crm-signal-tracker` / `run-crm-signal-trackers` / `list-crm-signal-hits` / `record-crm-smart-signal` / `record-crm-call-insight` / `review-crm-signal` / `get-crm-automation-recipe`|Call evidence and reviewable signals; smart detection goes through agent chat, cited to stored evidence.|
|`install-crm-pipeline-dashboard` / `get-crm-pipeline-data` / `get-crm-dashboard` / `get-crm-dashboard-panel` / `list-crm-dashboards` / `save-crm-dashboard` / `list-crm-dashboard-revisions` / `restore-crm-dashboard-revision`|Install, read, revision-write, restore the Pipeline dashboard.|
|`provider-api-catalog` / `provider-api-docs` / `provider-api-request` / `list-staged-datasets` / `query-staged-dataset` / `delete-staged-dataset`|Read-only escape hatch for an exact provider request no action expresses; stage and reduce large results.|

## Agent behavior

- Call `view-screen` when the request names the visible record, selection, or
  view. `navigate` to a view rather than describing it.
- Never flatten a failure into a normal-looking value: an unreadable owner,
  slot, or scope is reported as itself, never as empty. Read a value back before
  reporting it done.
- Recover from a recoverable error rather than abandoning the task.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
