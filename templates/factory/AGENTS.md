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
- Slack clear bugs go through `dispatch-factory-item`; never post Slack
  messages or `@handles`. GitHub issues and Sentry tag `@builderio-bot`
  on a GitHub issue. Read `review-latest-feedback` for thread evidence.
- PR governance follows `review-prs`: verify membership and evidence; skip
  drafts and external authors; apply the verified `liamdebeasi` exception for
  ordinary gates; keep ultra-scary risks manual; never auto-merge.
- Graph edits create immutable blueprint versions. AI proposes with `source=ai`;
  a person reviews and publishes through the same action surface.
- Provider credentials belong to Dispatch/shared workspace integrations, never
  to a Factory or Factory graph. Agents use shared provider APIs and connected
  MCP tools through the workspace grant boundary.
- Never put provider keys in hosted deployment env or Factory bootstrap.
  Hosted Factory reads Slack/GitHub/Sentry from workspace connections or the
  org vault. Local sqlite may read `.env` Slack/GitHub/Sentry keys last.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.

## Application state

- `navigation.view` is `factory` or `agents`. Runtime data is scoped by
  `factoryId`; reusable agents stay workspace-wide. Opening a factory
  defaults to Inbox. Read `view-screen` and `factory-graphs` for tab and
  selection keys.

## Action contract

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` | Inspect queue evidence; pass `factoryId`. |
| `get-triage-config` / `save-triage-config` | Read or save observation settings for one factory. |
| `poll-slack-channel` | Observe Slack history; never writes to Slack. |
| `get-slack-feedback-context` | Read the bounded full Slack thread before classification. |
| `poll-github-sources` / `poll-sentry-errors` | Observe bounded source queues. |
| `ingest-github-observation` | Store read-only PR evidence. |
| `list-triage-rules` / `save-triage-rule` | Tune rules and guards. |
| `evaluate-triage-item` | Append a decision. |
| `record-triage-feedback` | Capture human correction for learning. |
| `dispatch-factory-item` | Tag Builder or record a skip. Optional `reaction` marks the source if that provider can. |
| `govern-factory-pull-request` | Apply PR evidence and ownership gates. |
| `babysit-factory-pull-request` / `propose-pr-babysit-status` | Post the bot PR poke, or propose babysit status without writing. |
| `list-factory-automations` / `create-factory-automation` / `save-factory-automation` / `run-factory-automation` | List, create, edit, or run jobs. Factories start empty. Hosted jobs need a workspace connection or vault token. Author filters use Slack `U`/`W` or GitHub numeric ids. Limits are action-enforced. |
| `list-factory-audit` | Inspect inbox additions, worked items, and actions for one factory. |
| `get-factory-automation-health` | Inspect scheduler heartbeat and last error. |
| `suggest-factory-rules` | Mine feedback into proposals. |
| `reconcile-triage-run` | Persist PR-monitor observations; no GitHub write. |
| `list-factories` / `get-factory-graph` / `delete-factory` | Inspect Factory definitions, versions, and metrics, or permanently delete a user-created Factory after exact-name confirmation. Delete also removes jobs, run history, and poll cursors. Unconfirmed cleanup returns `verified:false`. |
| `create-factory` | Create a factory from `/new-factory`. Automations start empty. |
| `save-factory-graph` | Create/version a graph with inspected `expectedGraphVersion`; never starts provider work. |
| graph history actions | Factory graph version history. |
| `list-factory-comments` / `add-factory-comment` | Read or attach comments to a canvas, node, or edge. |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Use connected provider APIs with shared credentials; never request raw keys. |
| `list-workspace-apps` / `update-workspace-app-metadata` | Inventory and edit mounted apps. |
| `list-workspace-resources` / `create-workspace-resource` / `update-workspace-resource` | Manage shared agent resources. |
| `import-agent` / `import-agent-pack` / `list-agent-pack` | Import profiles or agent packs. |
| `start-workspace-app-creation` | Promote an agent and its pack into an app handoff. |

Rules start in shadow mode; hard guards apply. Organization automations use
stored prompts; external mutations require durable, idempotent runs and
provider confirmation. Poll and Builder/PR dispatch run only as this factory's
scheduled job, not chat and not a workspace-owner email match; teammates may
edit and Run now Factory jobs. Use the visual editor for graph changes and
agent chat for proposals; persist complete graphs with `save-factory-graph`.
Change rules through triage actions, never graph JSON.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
