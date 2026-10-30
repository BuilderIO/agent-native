# Factory

Factory is a workspace of named factories. A workflow, a graph the scheduler
runs and the canvas edits, is how it automates work. Dispatch owns shared inbox
routing. Factory owns queue state and jobs.

## Skills

Read relevant `.agents/skills/<name>/SKILL.md` guides before deeper work:
- `factory-workflows` — workflow and automation changes.
- `turn-into-app` / `turn-into-skill` — promote or capture proven workflows.
For other topics, read the matching skill.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query
"<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Keep app state in SQL via Drizzle, scope reads/writes by org and member, and use actions for UI, agent, CLI, MCP, and A2A.
- Missing callbacks, partial threads, unreadable provider responses, or missed reconciliation are failures; preserve typed errors or `reconciliation_required`.
- Deduplicate by Factory item and run identity, not provider comment id.
- Clear bugs reach Builder only through the code-enforced workflow step (clear,
  low risk, high confidence, no product/UX call, unclaimed). Agents never start
  Builder work or post findings; see `review-latest-feedback` for sweeps.
- PR governance follows `review-prs`: verify membership/evidence and skip
  drafts. Route confirmed external authors through the governance action for a
  manual disposition, never approval; skip fork PRs assigned to a
  verified BuilderIO member. Apply verified `liamdebeasi` trust only to
  ordinary gates; keep ultra-scary risks manual. Governance never merges;
  Builder PRs merge only through a workflow merge step after its gate.
- Provider credentials belong to Dispatch/workspace integrations, not Factory.
  Hosted reads use workspace connections or org vault; local dev may use
  `.env` Slack/GitHub/Sentry keys last.
- For external integrations, inspect the workspace/provider connection catalog
  first; reuse its scoped resolver.

## Application state

- `navigation.view` is `factory` on factory pages. `factoryId` picks the
  factory (none: the factory list) and `factoryTab` is `workflows` (default),
  `items`, `activity`, `settings` or `agents`. On Workflows, `workflowId` is the
  open canvas and `nodeId`, `edgeId`, `runId` what is selected or replayed. On
  Items, `factoryItemId`. `view-screen` matches the visible tab.

## Actions

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` / `get-triage-config` / `save-triage-config` | Queue reads, factory config |
| `poll-slack-channel` / `poll-github-sources` / `poll-sentry-errors` / `ingest-github-observation` | Bounded source evidence |
| `record-triage-feedback` | Record a person's decision |
| `govern-factory-pull-request` | Apply the PR governance gate |
| `list-factory-automations` / `create-factory-automation` / `save-factory-automation` / `run-factory-automation` | Manage agent-run jobs, not workflows |
| `describe-workflow-node-catalog` / `save-factory-workflow` / `rename-factory-workflow` / `run-factory-workflow` / `request-workflow-connection` / `set-factory-workflow-enabled` / `get-workflow-node-data` and other workflow reads | Author and run workflows; see `factory-workflows`. Diagnose odd runs with `get-workflow-diagnostics` first |
| `requeue-factory-item` / `dismiss-factory-item` | Retry an item (asks approval) or close it |
| `seed-story-run` | Dev server only: replay story fixtures; `purge` undoes it |
| `read-slack-thread` / `post-slack-message` / `send-factory-email` / `get-factory-pull-request` / `get-factory-merge-gate` / `merge-factory-pull-request` / `list-factory-items` / `create-hubspot-task` / `run-workflow-operation` | Graph-only provider calls. Reads may retry; writes never do. For `_outcome_unknown`, check whether it took effect before retrying |
| `list-factory-audit` / `get-factory-automation-health` / `reconcile-triage-run` | Queue history, scheduler, monitor observations |
| `list-factories` / `create-factory` / `delete-factory` | Manage factories |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Provider APIs, shared credentials |
| `list-workspace-apps` / `update-workspace-app-metadata` / `list-workspace-resources` / `create-workspace-resource` / `update-workspace-resource` | Manage mounted apps, shared resources |
| `import-agent` / `import-agent-pack` / `list-agent-pack` / `start-workspace-app-creation` | Import profiles/packs and hand off app creation |

Shadow mode is default; hard guards apply. External mutations need idempotent
runs and provider confirmation. Builder hand-off and merge are workflow steps;
PR governance is a scheduled agent job. Listing workflows or agent jobs pauses
retired seeded jobs once (`pausedReason: replaced_by_workflows`); none is
deleted. Teammates may edit/run. New automation is a workflow, never
`create-factory-automation`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper
work.
