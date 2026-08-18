# Factory

Factory is the visual workspace for building agent factories from incoming work
to governed delivery. The map is the source of truth; Dispatch owns the shared
inbox and routing, while Factory owns graph versions, queue state, rules,
decisions, feedback, agent runs, and provider audit records.

## Skills

- `factory-graphs` — read before graph, version, queue, rule, or decision work.
- `capture-learnings` — record a user preference or correction so it outlives
  the thread.
- `turn-into-app`, `turn-into-skill` — promote a proven workflow into its own
  app or a reusable skill.

## Core rules

- Keep app state in SQL via Drizzle, scope reads/writes by org and member, and
  use actions as the UI, agent, CLI, MCP, and A2A surface.
- A missing callback, partial thread, unreadable provider response, or missed
  reconciliation is not success; preserve typed failure or
  `reconciliation_required` state.
- Deduplicate by Factory item and rule/run identity, not provider comment ID.
- Use the generic Slack adapter: clear-bug automations add 👀 and tag
  `@builder.io`, ask Builder to run `/address-feedback`, and group repeated
  reports into one Builder thread; GitHub/Sentry clear bugs use the Builder run
  API. Clips, Design, and Content stay owner-managed outside autonomous
  dispatch and PR governance.
- PR governance follows `review-prs`: verify current BuilderIO membership and
  the complete diff/review/check evidence, never approve external or
  unverified authors, and keep ultra-scary security, auth, tenant-isolation,
  secrets, data-loss, execution, payment, and deployment risks manual. The
  verified internal-author evidence does not waive ordinary failed or
  unresolved checks or feedback; those gates remain required and their exact
  states must stay visible. It never waives membership or the ultra-scary
  gate.
  Product/UX ownership still needs the verified owner, with the documented Sid
  exception. Auto-merge also requires a verified Factory Builder run.
- Graph edits create immutable blueprint versions. AI proposes with `source=ai`;
  a person reviews and publishes through the same action surface.
- Provider credentials belong to Dispatch/shared workspace integrations, never
  to a Factory or Factory graph. Agents use shared provider APIs and connected
  MCP tools through the workspace grant boundary.

## Application state

- `navigation.view` is `factory` or `agents`; `factoryId`, `factoryTab`,
  `factoryAuditRunId`, `factoryNodeId`, and `factoryEdgeId` hold the selected
  Factory context. Read `view-screen` before explaining a route, changing the
  selected Factory, or answering about the `/agents` inventory.

## Action contract

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` | Inspect bounded queue evidence; scheduled reviewers pass `needsReview: true`, `source`, and `limit`. |
| `poll-slack-channel` | Observe Slack history; never writes to Slack. |
| `get-slack-feedback-context` | Read the bounded full Slack thread before classification. |
| `poll-github-sources` / `poll-sentry-errors` | Observe bounded source queues. |
| `ingest-github-observation` | Store read-only PR evidence. |
| `list-triage-rules` / `save-triage-rule` | Tune rules and guards. |
| `evaluate-triage-item` | Append a decision. |
| `record-triage-feedback` | Capture human correction for learning. |
| `approve-factory-item` | Explicitly authorize one bounded run. |
| `start-builder-for-item` | Govern clear-bug dispatch through Slack or Builder API, or record a skip reason. |
| `govern-agent-native-pull-request` | Apply PR evidence and ownership gates. |
| `list-factory-automations` / `save-factory-automation` / `run-factory-automation` | Inspect or edit org-owned automations. |
| `list-factory-audit` | Inspect automation runs, evidence, decisions, and provider actions. |
| `get-factory-automation-health` | Inspect scheduler heartbeat and last error. |
| `suggest-factory-rules` | Mine feedback into proposals. |
| `reconcile-triage-run` | Persist callback/provider reconciliation. |
| `list-factories` / `get-factory-graph` | Inspect definitions, versions, and metrics. |
| `save-factory-graph` | Create or version a complete visual graph; never starts provider work. |
| `list-factory-comments` / `add-factory-comment` | Read or attach comments to a canvas, node, or edge. |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Use connected provider APIs with shared credentials; never request raw keys. |
| `list-workspace-apps` / `update-workspace-app-metadata` | Inventory and edit mounted apps. |
| `list-workspace-resources` / `create-workspace-resource` / `update-workspace-resource` | Manage shared agent resources. |
| `import-agent` / `import-agent-pack` / `list-agent-pack` | Import profiles or agent packs. |
| `start-workspace-app-creation` | Promote an agent and its pack into an app handoff. |

Rules start in shadow mode; hard guards always apply. Organization automations
execute stored prompts, and every external mutation needs a durable run,
idempotency key, and provider confirmation. The legacy observer ends once org
automations are seeded. Use the visual editor for graph changes and agent chat
for proposals; persist complete graphs with `save-factory-graph`. Change rules
through triage rule actions, never graph JSON.

The Slack, GitHub, and Sentry pollers are bounded ingestion adapters for the
legacy default triage queue. They do not define the complete tool surface.
Interactive and scheduled agents may discover additional connected provider or
MCP tools through the shared workspace context.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
