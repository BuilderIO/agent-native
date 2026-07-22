# CRM — Agent Guide

CRM is a standalone Native SQL CRM and a HubSpot/Salesforce Connected/Hybrid
companion. Actions are the shared contract for UI, agent chat, HTTP, MCP, A2A,
and CLI. Read `shared/crm-contract.ts` before changing CRM semantics; it is the
source of truth for vocabulary, field policies, provenance, provider identity,
and write policy.

## Hard boundaries

- Native SQL, HubSpot, and Salesforce are the initial modes. Native SQL is
  local-authoritative, requires no external connection, and stays portable
  across SQLite, Postgres, and D1.
- Workspace Connections own provider credentials. Never ask for, store, log,
  or expose provider tokens.
- The local mirror is scoped and thin. Unknown fields are remote-only;
  sensitive fields default to redacted; only allow-listed fields are mirrored.
- Never store raw provider payloads, transcripts, audio, video, screenshots,
  base64, or file bodies in SQL. Evidence is a URL/id plus bounded quote,
  timestamp, speaker, and source metadata.
- Do not merge identities from email/domain matches. Preserve the provider
  identity tuple and directional relationships.

## Actions

| Action                                                                                 | Purpose                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `get-crm-overview`                                                                     | Read the scoped CRM summary and connection/mirror health.                                               |
| `configure-native-crm`                                                                 | Start a local-authoritative Native SQL CRM without a provider connection.                               |
| `configure-crm-connection`                                                             | Register an authorized HubSpot or Salesforce workspace Connection for the companion mirror.             |
| `list-crm-records`                                                                     | List a bounded set of CRM records using declared filters.                                               |
| `get-crm-record`                                                                       | Read one record and its permitted scoped detail.                                                        |
| `sync-crm`                                                                             | Refresh a declared mirror cohort; never treat it as an export-all operation.                            |
| `list-crm-saved-views` / `save-crm-saved-view`                                         | List or save scoped CRM views.                                                                          |
| `install-crm-pipeline-dashboard`                                                        | Idempotently verify and install the CRM-owned Pipeline dashboard and data program.                     |
| `get-crm-pipeline-data`                                                                  | Read bounded, access-scoped opportunity totals by stage for the dashboard program.                     |
| `get-crm-dashboard` / `list-crm-dashboards` / `save-crm-dashboard`                      | Read, list, or revision-write access-scoped Pipeline dashboards.                                       |
| `list-crm-dashboard-revisions` / `restore-crm-dashboard-revision`                       | Inspect and restore a dashboard's bounded revision history.                                            |
| `list-crm-tasks` / `manage-crm-task`                                                   | Read and manage CRM follow-up tasks.                                                                    |
| `update-crm-record`                                                                    | Submit a typed, access-checked, revision-aware record mutation.                                         |
| `list-crm-proposals` / `apply-crm-proposals`                                           | Review provider proposals and record the upstream handoff.                                              |
| `attach-call-evidence`                                                                 | Attach a bounded call evidence reference; never attach a transcript or media.                           |
| `create-crm-signal-tracker` / `list-crm-signal-trackers` / `manage-crm-signal-tracker` | Create, inspect, enable, disable, or delete access-scoped keyword and delegated-agent moment detectors. |
| `run-crm-signal-trackers` / `list-crm-signal-hits`                                     | Find deterministic hits and prepare bounded smart/summary agent work.                                   |
| `record-crm-smart-signal` / `record-crm-call-insight`                                  | Persist only evidence-grounded delegated results as reviewable signals.                                 |
| `review-crm-signal`                                                                    | Confirm or dismiss one grounded CRM signal.                                                             |
| `view-screen`                                                                          | Read current navigation, selection, and visible CRM context.                                            |
| `navigate`                                                                             | Move the UI to overview, records, tasks, proposals, or settings.                                        |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request`                  | Discover and make authorized, read-only exact provider API requests.                                    |
| `query-staged-dataset`                                                                 | Reduce staged, paginated provider results for broad analyses.                                           |
| data program, automation, extension surfaces                                           | Use shared framework capabilities under their scoped access and data limits.                            |

## Agent behavior

- Call `view-screen` before acting on “this record,” “these accounts,” the
  selected row, or a visible saved view. For standalone read requests, call the
  focused CRM action directly.
- Navigate before presenting a requested CRM view. Keep visible context aligned
  with the action result.
- For a standalone CRM, use `configure-native-crm`; then create and update
  local-authoritative records through the normal CRM actions. Do not call
  `sync-crm`, provider API actions, or require a workspace Connection for
  Native SQL.
- Use first-class actions for ordinary workflows. For an exact HubSpot or Salesforce API
  request that actions cannot express, discover it with provider API actions,
  fetch it with explicit pagination, then stage/reduce large results. Report
  source, scope, filters, counts, pagination, and uncertainty.
- Agent provider changes are normally proposals. Changes involving ownership,
  amounts, stage, deletion, bulk scope, or external side effects require an
  exact preview and approval. This release does not complete provider writes:
  review the proposal, direct the user to make the change in HubSpot or
  Salesforce, and never claim the upstream change succeeded.
- Use `run-crm-signal-trackers` for attached Clips evidence. Keyword detectors
  run locally; smart detectors and call summaries are delegated through agent
  chat. Record only exact, bounded evidence citations through the signal record
  actions. Never pass or reconstruct a transcript.
- Manage a tracker only with editor access. Enabling, disabling, and deleting a
  tracker are local CRM configuration changes: they never invoke a model or
  mutate a connected provider. Use `navigate` with
  `{ view: "settings", settingsSection: "intelligence" }` to open its settings tab.
- Use `install-crm-pipeline-dashboard` to set up the Pipeline view. It owns one
  per-user data program that calls `get-crm-pipeline-data`; do not replace it
  with a provider-specific action or embed raw rows in dashboard config. Use
  `save-crm-dashboard` with `expectedUpdatedAt` for dashboard edits, and
  `restore-crm-dashboard-revision` to roll back a saved revision.

## Four-area change guide

When changing a provider workflow, keep UI, actions, agent instructions, and
application state aligned. The setup route records the selected native mode or
connection; `configure-native-crm`, `configure-crm-connection`, and `sync-crm`
are the shared UI/agent operations; signal selection stores record/evidence IDs
only; `view-screen` and `navigate` expose the selected CRM context. Do not introduce provider-specific API routes, browser
credential inputs, or unscoped state.

## Implementation

Before building common workspace or agent UI, read `agent-native-toolkit`; use
`customizing-agent-native` when composing or ejecting shared surfaces.

Use `defineAction` and action hooks rather than duplicate `/api` CRUD routes.
Use shared Toolkit surfaces for connections, settings, navigation, sharing,
automations, and extensions before adding app-local equivalents. Keep SQL
schema changes additive and preserve access-scope checks independently from
provider permissions.
