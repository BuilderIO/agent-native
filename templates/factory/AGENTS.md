# Factory

Factory is the visual workspace for building agent factories from incoming work
to governed delivery. The map is the source of truth; Dispatch owns the shared
inbox and routing, while Factory owns graph versions, queue state, rules,
decisions, feedback, agent runs, and provider audit records.

Before building common workspace or agent UI, read `agent-native-toolkit`; use
`customizing-agent-native` for the configure → compose → eject → propose
ladder.

## Core rules

- Keep app state in SQL via Drizzle, scope reads/writes by org and member, and
  use actions as the UI, agent, CLI, MCP, and A2A surface.
- Keep migrations additive and portable. These org-visible tables use explicit
  `ownerEmail`/`orgId`, not `ownableColumns()`; add deliberate visibility data
  before using `accessFilter`.
- Resolve Slack through `server/connectors/credentials.ts` with caller identity
  supplied at the entrypoint; never read `SLACK_BOT_TOKEN` directly.
- A missing callback, partial thread, unreadable provider response, or missed
  reconciliation is not success; preserve typed failure or
  `reconciliation_required` state.
- Auth, identity, credentials/vault, migrations, payments, security, and
  publishable `packages/*` changes are code-level guards requiring human review.
- Deduplicate by Factory item and rule/run identity, not provider comment ID.
- Use the generic Slack adapter: clear-bug automations add 👀 and tag
  `@builderio`; GitHub/Sentry clear bugs use the Builder run API. Clips, Design,
  and Content stay owner-managed outside autonomous dispatch and PR governance.
- PR governance requires verified BuilderIO membership, a clear bug, passing CI,
  and handled review feedback; product/UX implications stay manual. Auto-merge
  also requires a verified Factory Builder run.
- Reuse the ai-services GitHub read and Builder execution APIs; do not duplicate
  GitHub installation/webhook infrastructure here.
- Do not add CRUD routes under `server/routes/api/`; actions are the domain
  surface. Provider callbacks must verify signatures.
- Graph edits create immutable blueprint versions. AI proposes with `source=ai`;
  a person reviews and publishes through the same action surface.

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
| `start-builder-for-item` | Govern clear-bug dispatch through Slack or Builder API. |
| `govern-agent-native-pull-request` | Apply CI, review, author, product, and owner gates. |
| `list-factory-automations` / `save-factory-automation` / `run-factory-automation` | Inspect or edit org-owned prompts, schedules, and runs. |
| `list-factory-audit` | Inspect automation runs, evidence, decisions, and provider actions. |
| `get-factory-automation-health` | Inspect scheduler heartbeat and last error. |
| `suggest-factory-rules` | Mine feedback and fast approvals into proposals. |
| `reconcile-triage-run` | Persist callback/provider reconciliation. |
| `list-factories` / `get-factory-graph` | Inspect Factory definitions, graph versions, and live evidence metrics. |
| `save-factory-graph` | Create or version a complete visual graph; never starts provider work. |
| `list-factory-comments` / `add-factory-comment` | Read or attach comments to a canvas, node, or edge. |

Rules start in shadow mode; hard guards always apply. Organization automations
execute stored prompts, and every external mutation needs a durable run,
idempotency key, and provider confirmation. The legacy observer ends once org
automations are seeded. Use the visual editor for graph changes and agent chat
for proposals; persist complete graphs with `save-factory-graph`. Change rules
through triage rule actions, never graph JSON.

## Scheduler identity

`WORKSPACE_OWNER_EMAIL` is startup-only deployment-org and seed identity; never
use it for request authorization or credential resolution.

## Hosting

Production needs `DATABASE_URL`, `WORKSPACE_OWNER_EMAIL`, and
`FACTORY_PUBLIC_URL`; Builder execution also needs its service URL, project ID,
and workspace credentials. GitHub/Sentry use workspace credentials. Callbacks
and external writes stay auditable and fail closed on partial evidence.
