# CRM — Agent Guide

CRM is a HubSpot Connected/Hybrid companion. Actions are the shared contract
for UI, agent chat, HTTP, MCP, A2A, and CLI. Read `shared/crm-contract.ts`
before changing CRM semantics; it is the source of truth for vocabulary, field
policies, provenance, provider identity, and write policy.

## Hard boundaries

- This phase implements HubSpot only. Salesforce and native CRM storage are
  explicitly out of scope.
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

| Action                                                                | Purpose                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `get-crm-overview`                                                    | Read the scoped CRM summary and connection/mirror health.                     |
| `configure-crm-connection`                                            | Register an authorized HubSpot workspace Connection for the companion mirror. |
| `list-crm-records`                                                    | List a bounded set of CRM records using declared filters.                     |
| `get-crm-record`                                                      | Read one record and its permitted scoped detail.                              |
| `sync-crm`                                                            | Refresh a declared mirror cohort; never treat it as an export-all operation.  |
| `list-crm-saved-views` / `save-crm-saved-view`                        | List or save scoped CRM views.                                                |
| `list-crm-tasks` / `manage-crm-task`                                  | Read and manage CRM follow-up tasks.                                          |
| `update-crm-record`                                                   | Submit a typed, access-checked, revision-aware record mutation.               |
| `list-crm-proposals` / `apply-crm-proposals`                          | Review and apply authorized agent/provider mutation proposals.                |
| `attach-call-evidence`                                                | Attach a bounded call evidence reference; never attach a transcript or media. |
| `view-screen`                                                         | Read current navigation, selection, and visible CRM context.                  |
| `navigate`                                                            | Move the UI to overview, records, tasks, proposals, or settings.              |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Discover and make authorized exact provider API requests.                     |
| `query-staged-dataset`                                                | Reduce staged, paginated provider results for broad analyses.                 |
| data program, automation, extension surfaces                          | Use shared framework capabilities under their scoped access and data limits.  |

## Agent behavior

- Call `view-screen` before acting on “this record,” “these accounts,” the
  selected row, or a visible saved view. For standalone read requests, call the
  focused CRM action directly.
- Navigate before presenting a requested CRM view. Keep visible context aligned
  with the action result.
- Use first-class actions for ordinary workflows. For an exact HubSpot API
  request that actions cannot express, discover it with provider API actions,
  fetch it with explicit pagination, then stage/reduce large results. Report
  source, scope, filters, counts, pagination, and uncertainty.
- Agent provider changes are normally proposals. Changes involving ownership,
  amounts, stage, deletion, bulk scope, or external side effects require an
  exact preview and approval. Never overwrite a conflict or claim a provider
  change succeeded without its returned status.

## Implementation

Before building common workspace or agent UI, read `agent-native-toolkit`; use
`customizing-agent-native` when composing or ejecting shared surfaces.

Use `defineAction` and action hooks rather than duplicate `/api` CRUD routes.
Use shared Toolkit surfaces for connections, settings, navigation, sharing,
automations, and extensions before adding app-local equivalents. Keep SQL
schema changes additive and preserve access-scope checks independently from
provider permissions.
