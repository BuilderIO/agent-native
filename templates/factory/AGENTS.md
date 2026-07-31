# Factory

Factory is the visual workspace for building agent factories from incoming work
to governed delivery. The map is the source of truth; Dispatch owns the shared
inbox and routing, while Factory owns graph versions, queue state, rules,
decisions, feedback, agent runs, and provider-action audit records.

Before building common workspace or agent UI, read `agent-native-toolkit`; use
`customizing-agent-native` for the configure → compose → eject → propose
ladder.

## Core rules

- Keep app state in SQL via Drizzle and scope every read/write by org and
  authenticated member. Use actions as the UI, agent, CLI, MCP, and A2A surface.
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
- Slack interaction uses the generic Agent-Native Slack adapter. Polling is for
  observation; mentions are for explanation, rule tuning, and explicit approval.
- Reuse the existing ai-services GitHub read and Builder execution APIs. Do not
  duplicate GitHub installation/webhook infrastructure in this template.
- Do not add CRUD routes under `server/routes/api/`; actions are the domain
  surface. Provider callbacks are the only exception and must verify signatures.
- Factory graph edits create immutable blueprint versions. AI proposes a
  complete graph with `source=ai`; a person reviews and publishes it through
  the same action surface as manual edits. The current evaluator runs enabled
  rules in parallel, so graph edges describe intended handoffs until a runtime
  binding exists.
- A selected graph node or edge is part of `navigation` context. Read
  `view-screen` before answering why a route exists or changing the selected
  Factory.

## Application state

- `navigation.view`: `factory` when the visual workspace is open.
- `navigation.factoryId`: selected Factory id when present.
- `navigation.factoryTab`: `map` | `inbox` | `rules` | `settings`.
- `navigation.factoryNodeId` / `navigation.factoryEdgeId`: selected graph target.

## Action contract

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` | Inspect the queue and evidence. |
| `poll-slack-channel` | Observe Slack history; never writes to Slack. |
| `ingest-github-observation` | Store read-only PR evidence. |
| `list-triage-rules` / `save-triage-rule` | Tune prompt rules and guards. |
| `evaluate-triage-item` | Append a structured decision. |
| `record-triage-feedback` | Capture human correction for learning. |
| `approve-factory-item` | Explicitly authorize one bounded run. |
| `suggest-factory-rules` | Mine feedback and fast approvals into proposals. |
| `reconcile-triage-run` | Persist callback/provider reconciliation. |
| `list-factories` / `get-factory-graph` | Inspect Factory definitions, graph versions, and live evidence metrics. |
| `save-factory-graph` | Create or version a complete visual graph; never starts provider work. |
| `list-factory-comments` / `add-factory-comment` | Read or attach comments to a canvas, node, or edge. |

Rules start in shadow mode. Enabling a rule never bypasses hard guards or
creates an implicit approval. Slack "do it now" and the UI approval control
both call `approve-factory-item`, which records the approver before dispatch.

Use the visual editor for direct blueprint changes. Use the agent chat for
natural language design, explanations, and proposals; it must preserve a
complete graph and use `save-factory-graph` rather than describing an
unpersisted change. Rule or guard changes must go through the triage rule
actions, never through graph JSON.

## Scheduler identity

`WORKSPACE_OWNER_EMAIL` is read only at startup to stamp the deployment-owned
job's `createdBy`; it is never caller identity and must not enter request
authorization or credential resolution.

## Hosting

Production needs `DATABASE_URL`, `WORKSPACE_OWNER_EMAIL`, and
`FACTORY_PUBLIC_URL`. Builder execution additionally needs the service URL and
project ID plus workspace-resolved Builder credentials. Keep rules in shadow
mode and require an explicit approval for every provider run.
