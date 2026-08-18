---
name: crm
description: How to run typed CRM work — attributes and options, lists and pipelines, saved and board views, provider proposals, duplicates and merge, gated enrichment, and evidence-grounded call signals. Use for any CRM read, write, setup, or provider question.
---

# CRM

`AGENTS.md` owns the invariants (attribute typing, bitemporal values, list
authority, the provider handoff, credential and evidence boundaries). This skill
is the how: which action, in what order, and the traps in between. Do not
restate a rule here that `AGENTS.md` already states — fix it there instead.

Model source of truth: `shared/crm-contract.ts`. Type registry:
`shared/crm-attributes.ts`. Every field-value write goes through
`server/lib/record-fields.ts`.

## Pick the starting action

- `get-crm-workspace` — "what should I work on", who the caller is, whether
  their provider owner identity resolved. Read `ownerStatus` before trusting an
  empty book: `unmapped`, `ambiguous`, and `unreadable` are different failures,
  and none of them mean "no records".
- `view-screen` — only when the request depends on the visible record,
  selection, list, or view. `navigate` to show a view rather than describing it.
- `list-crm-records` / `get-crm-record` / `get-crm-record-page` — ordinary reads.
- `sync-crm` — one declared, bounded provider cohort. It is not an export-all,
  and Native SQL never needs it.

## Setup and modes

- `configure-native-crm` starts a local-authoritative CRM with no provider,
  portable across SQLite, Postgres, and D1. Then use the normal record, list,
  task, view, and evidence actions. Never require a connection for Native SQL.
- After HubSpot or Salesforce is authorized in workspace Connections, register
  it with `configure-crm-connection`. Never pass a token. HubSpot starts with
  companies/contacts/deals; Salesforce with Account/Contact/Opportunity.
- `list-crm-connections` shows which object types a connection carries — read it
  before authoring attributes on an object type.
- Salesforce reads are revalidated against the current connection actor and
  field permissions. Never infer a user's access from a service-account mirror
  or a previously visible local row; fail closed when access is ambiguous.

## Typed attributes and options

- `list-crm-attributes` before any read, write, filter, or grouping. It returns
  the type, cardinality (`multi`), authority, and managed options.
- `create-crm-attribute` derives an immutable snake_case `apiSlug` from the
  title. `update-crm-attribute` can change presentation, `required`,
  `historyTracked`, config, `archived`, and `fillMode` — never the slug or the
  type, because every stored value row is keyed and typed by them.
- `manage-crm-attribute-option` adds an option *before* a value that uses it is
  written. Archiving an option removes it from pickers only; records already
  holding it keep the value.
- `archive-crm-attribute` is a soft archive. Values and history stay. Restore
  with `update-crm-attribute` and `archived: false`.
- Status options may carry `targetDays` (a stage SLA the grid shows as overrun)
  and `celebrate`.

## Reading the grid

- `list-crm-records` returns row summaries; `list-crm-record-values` returns the
  cells for those rows with provenance. Filter, sort, and pagination all run in
  SQL, so a filtered page is the real result set, not one page narrowed
  afterwards. Pass `viewId` to apply a saved view's stored filter.
- A filter naming an unknown or archived attribute fails rather than quietly
  returning unfiltered rows. Do not "fix" that by dropping the filter.
- `get-crm-record-page` is the whole record surface in one call: attribute
  definitions, current values with actor and time, every list the record is in
  with that entry's values, and the provider deep link.

## Lists and pipelines

- A list is a workflow overlay over one object type; entry attributes belong to
  the list, not the record. `create-crm-list` seeds a Stage attribute unless you
  pass `seedStageAttribute: false`.
- `add-crm-record-to-list` never de-duplicates — it returns `existingEntryIds`
  and lets you decide. Two open deals for one company are two entries.
- **Moving a stage is `update-crm-list-entry`.** It closes the previous value's
  row and opens a new one, so time-in-stage is derivable from the entry's own
  history without a separate audit table.
- Every `status` write goes through `server/lib/lifecycle.ts`. The enterable set
  is the attribute's own options, so a move into an undeclared or archived stage
  is refused with a sentence naming the values you may pick (`unknown-status`,
  `archived-status`), and the move is claimed against the value it was decided
  from, so a stage somebody else moved in between comes back as
  `concurrent-transition` instead of being clobbered. Leaving any stage —
  including a retired one — is always allowed. On a record, `update-crm-record`
  applies the same gate to local targets; a provider target is still a proposal,
  not a blocked transition.
- `remove-crm-list-entry` deletes membership and that entry's values only. It is
  not a way to delete a record.
- `list-crm-record-field-history` reads either side: pass `entryId` for a stage
  history, `recordId` for a record attribute.

## Views and boards

`save-crm-saved-view` stores filter, ordered sort, columns, `table`/`board`
presentation, and personal/shared audience. A board view needs a
`groupByAttributeId` pointing at a status attribute. Pass `expectedUpdatedAt` so
a concurrent edit is rejected instead of silently overwritten. A view stores
presentation, never provider rows. `run-crm-saved-view-program` runs the data
program linked to one view.

## Writes and the provider handoff

- `update-crm-record` for a scoped typed edit. Provider-owned fields become
  revision-aware, access-checked, idempotent, audited proposals.
- `list-crm-proposals` then `apply-crm-proposals`: the second returns the exact
  before/after diff and a deep link, and records the handoff. A proposal with
  status `approved` and no `appliedAt` was prepared and handed off — present
  that as the next step for the user, never as a failure and never as applied.
- The only stored delegation pack is `crm-sales-routine-local-v1`: one routine,
  compensatable local update to one record, supplied by a trusted automation
  trigger, never by action input.

## Duplicates and merge

`find-crm-duplicates` is read-only and never merges. It matches on exact email,
company domain, shared email root domain, and normalized name plus location, and
returns a reason and confidence per candidate. A shared company domain is a
signal between accounts only — colleagues are a relationship, not a duplicate.

`merge-crm-records` needs an explicit survivor. It promotes only the values the
survivor lacks, moves list entries, tasks, interactions, evidence, signals, and
relationships from both sides, and tombstones the loser with a `merged-into`
link instead of deleting it. It is idempotent and approval-gated for non-human
callers. Show the candidate reasons and let a human pick the survivor.

## Enrichment (money changes hands)

1. `list-crm-enrichment-slots` — which capability slots are usable. A slot's
   `credential.status` of `unknown` means the lookup itself failed and is *not*
   the same as `missing`.
2. `estimate-crm-enrichment` — line-item cost and period-to-date spend. Quote it
   to the user. `spendToDate.actorUnits` is theirs and is what the cap applies
   to; `workspaceUnits` is everyone's and is context only.
3. `run-crm-enrichment` with `phase: "verify"` — free evidence pass, never
   touches contact data. A human reviews its per-record evidence.
4. `run-crm-enrichment` with `phase: "spend"` — requires `sourceRunId` and the
   explicit `approvedRecordIds` from that review. The paid input set is built
   from those approvals, so an unapproved record is never visible to the paid
   job. Both phases refuse a duplicate in-flight run for the same scope.

A slot outcome is one of `unconfigured`, `skipped`, `ok`, `empty`, or `error` —
report the one you got. "We could not find out" is not "there is none".

## Agent attribute fill

`run-crm-attribute-fill` is manual only. Call it with no `values` to get the
brief (attribute, managed options, each record's current value and context),
reason over that yourself, then call again with `values`. Never call a model
inline. Writes merge: a human edit or a purchased value is kept and reported as
`kept-existing`, an equal value is not rewritten. Classifying against a
status/select attribute must produce one of its managed options; an unknown one
rejects the whole call and writes nothing.

## Evidence and signals

- `attach-call-evidence` stores only a source URL/id, bounded quote, timestamp,
  speaker, and metadata. For Clips use a durable `/share/<id>` or `/r/<id>` page
  URL with no access token or transcript fragment — never a `clip.created` event
  URL.
- `run-crm-signal-trackers` runs only over evidence already attached to the
  record. Keyword hits are deterministic; smart detectors and summaries are
  delegated through agent chat, never a direct model call, and persisted with
  `record-crm-smart-signal` or one atomic `record-crm-call-insight` batch whose
  every quote and timestamp cites an exact stored evidence row.
- `create-crm-signal-tracker` / `manage-crm-signal-tracker` need editor access.
  Enabling, disabling, and deleting a tracker are local configuration only:
  never a model call, never a provider mutation. Their settings tab is
  `navigate({ view: "settings", settingsSection: "intelligence" })`.
- `review-crm-signal` is the human confirm/dismiss step.
- `get-crm-automation-recipe` returns the default-off Clips review recipe for
  one explicitly selected record. The recipe is a configuration aid, not
  permission to activate it: show the exact Clips-owned `clip.created` trigger,
  the selected record, and its one bounded local evidence write, then get a fresh
  approval. The trigger must call `prepare-crm-call-evidence` with the clip id
  and hand back only the durable `/r/<id>` reference. It cannot create tasks,
  field updates, proposals, or provider mutations.

## Dashboards

`install-crm-pipeline-dashboard` is idempotent and owns one per-user data
program that calls the bounded `get-crm-pipeline-data` through `appAction`. Do
not reimplement that aggregate with a provider request or put CRM rows in
dashboard config. Edit with `save-crm-dashboard` plus `expectedUpdatedAt`;
inspect and roll back with `list-crm-dashboard-revisions` /
`restore-crm-dashboard-revision`.

## Provider API escape hatch

CRM actions are convenience workflows, not a capability ceiling. For an
endpoint, object, filter, pagination mode, or schema no action expresses, use
`provider-api-catalog`, then `provider-api-docs`, then the read-only
`provider-api-request`. Declare a cohort, selected fields, and a page/row budget
first; stage only that result and reduce it with `query-staged-dataset` or a
data program. Report provider, scope, filters, page/row counts, truncation, and
gaps. Always pass the selected workspace `connectionId` for Salesforce so its
actor-bound token and instance URL cannot be separated.

## Out of scope

No provider migration, no page builder, no raw provider payload or media in CRM
SQL. Native SQL supports the canonical CRM objects plus generic custom records; a
separate object-authoring engine is not part of this template.
