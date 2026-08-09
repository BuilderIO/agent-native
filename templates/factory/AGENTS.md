# Factory

Factory is the visual workspace for building agent factories from incoming work
to governed delivery. The map is the source of truth; Dispatch owns the shared
inbox and routing, while Factory owns graph versions, queue state, rules,
decisions, feedback, agent runs, and provider audit records.

Before building common workspace or agent UI, read `agent-native-toolkit`; use
`customizing-agent-native` for the configure → compose → eject → propose
ladder.

## Core rules

- Keep app state in SQL via Drizzle and scope every read/write by org and
  member. Use actions as the UI, agent, CLI, MCP, and A2A surface.
- Keep migrations additive and portable. These tables intentionally use explicit
  `ownerEmail`/`orgId` columns for org-visible data, not `ownableColumns()`;
  do not call `accessFilter` on them without adding deliberate visibility data.
- Resolve Slack through `server/connectors/credentials.ts`, passing caller
  identity at the entrypoint. The dependency guard does not inspect nested
  connector code, so a new direct `process.env.SLACK_BOT_TOKEN` read is a bug.
- A missing callback, partial thread, unreadable provider response, or missed
  reconciliation is not success. Preserve typed failure or
  `reconciliation_required` state.
- Hard guards are code, not prompt text: auth, session, identity,
  credentials/vault, migrations, payments, security, and publishable
  `packages/*` changes always require human review.
- All work is deduped by Factory item and rule/run identity. Provider comment IDs
  are not the idempotency boundary.
- Slack interaction uses the generic Agent-Native Slack adapter. Clear-bug Slack
  automations add 👀 and tag `@builderio` in the source thread; GitHub and Sentry
  clear bugs use the Builder run API. Clips, Design, and Content are always
  owner-managed and never enter autonomous dispatch or PR governance.
- PR governance requires verified BuilderIO membership, a clear bug, passing
  CI, and handled review feedback. Product or UX implications stay
  manual. Auto-merge additionally requires a verified Factory Builder run.
- Reuse the existing ai-services GitHub read and Builder execution APIs. Do not
  duplicate GitHub installation/webhook infrastructure in this template.
- Do not add CRUD routes under `server/routes/api/`; actions are the domain
  surface. Provider callbacks are the only exception and must verify signatures.
- Factory graph edits create immutable blueprint versions. AI proposes a graph
  with `source=ai`; a person reviews and publishes it through
  the same action surface as manual edits.

## Application state

- `navigation.view`: `factory` when the workspace is open.
- `navigation.factoryId`: selected Factory id when present.
- `navigation.factoryTab`: `map` | `inbox` | `rules` | `automations` | `audit` | `settings`.
- `navigation.factoryAuditRunId`: selected automation run in the audit view when present.
- `navigation.factoryNodeId` / `navigation.factoryEdgeId`: selected graph item.
- A selected graph node or edge is part of `navigation` context. Read
  `view-screen` before answering why a route exists or changing the selected
  Factory.

## Action contract

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` | Inspect queue and evidence. |
| `poll-slack-channel` | Observe Slack history; never writes to Slack. |
| `get-slack-feedback-context` | Read the bounded full Slack thread before classification. |
| `poll-github-sources` / `poll-sentry-errors` | Observe bounded GitHub and Sentry source queues. |
| `ingest-github-observation` | Store read-only PR evidence. |
| `list-triage-rules` / `save-triage-rule` | Tune prompt rules and guards. |
| `evaluate-triage-item` | Append a decision. |
| `record-triage-feedback` | Capture human correction for learning. |
| `approve-factory-item` | Explicitly authorize one bounded run. |
| `start-builder-for-item` | Govern clear-bug dispatch; Slack tags Builder in-thread, other sources use Builder API. |
| `govern-agent-native-pull-request` | Apply CI, review, internal-author, product, and owner gates to PR approval/merge. |
| `list-factory-automations` / `save-factory-automation` / `run-factory-automation` | Inspect and edit org-owned Factory prompts, models, schedules, and runs. |
| `list-factory-audit` | Inspect recent automation runs with their source observations, decisions, and provider actions. |
| `get-factory-automation-health` | Inspect the durable scheduler heartbeat and last scheduler error when runs appear stale. |
| `suggest-factory-rules` | Mine feedback and fast approvals into proposals. |
| `reconcile-triage-run` | Persist callback/provider reconciliation. |
| `list-factories` / `get-factory-graph` | Inspect Factory definitions, graph versions, and live evidence metrics. |
| `save-factory-graph` | Create or version a complete visual graph; never starts provider work. |
| `list-factory-comments` / `add-factory-comment` | Read or attach comments to a canvas, node, or edge. |

Rules start in shadow mode; hard guards always apply. Editable organization
automations execute stored prompts; every external mutation needs a durable run,
idempotency key, and provider confirmation. The legacy observer is disabled
once organization automations are seeded.

Use the visual editor for direct blueprint changes. Use the agent chat for
natural language design, explanations, and proposals; it must preserve a
complete graph and use `save-factory-graph` rather than describing an
unpersisted change. Rule or guard changes must go through the triage rule
actions, never through graph JSON.

## Scheduler identity

`WORKSPACE_OWNER_EMAIL` is read only at startup to find the deployment org and
stamp seeded automation `createdBy`; it is never caller identity and must not
enter request authorization or credential resolution.

## Hosting

Production needs `DATABASE_URL`, `WORKSPACE_OWNER_EMAIL`, and
`FACTORY_PUBLIC_URL`. Builder execution additionally needs the service URL,
project ID, and workspace-resolved Builder credentials. GitHub and Sentry
polling use workspace-resolved provider credentials. Provider callbacks and
external writes must remain auditable and fail closed when evidence is partial.
