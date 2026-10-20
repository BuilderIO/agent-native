# Factory

Factory is a workspace of named factories. A workflow, a graph the scheduler
runs and the canvas edits, is how it automates work. Dispatch owns shared inbox
routing. Factory owns queue state and jobs.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/factory-workflows/SKILL.md` — before building, editing, running, connecting or enabling any workflow, and for any request to automate something.
- `.agents/skills/turn-into-app/SKILL.md` — to promote a proven workflow into an app.
- `.agents/skills/turn-into-skill/SKILL.md` — to capture a workflow as a reusable skill.

Also read, as the work needs, `.agents/skills/<name>/SKILL.md` for: `actions`, `adding-a-feature`, `storing-data`, `security`, `secrets`, `sharing`, `frontend-design`, `shadcn-ui`, `real-time-sync`, `context-awareness`, `delegate-to-agent`, `agent-native-docs`, `agent-native-toolkit`, `customizing-agent-native`, `client-side-routing`, `reliable-mutations`, `performance`, `external-agents`, `portability`, `review-latest-feedback`, `review-prs`, `self-modifying-code`, `workspace-conventions`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Keep app state in SQL via Drizzle, scope reads/writes by org and member, and use actions for UI, agent, CLI, MCP, and A2A.
- Missing callbacks, partial threads, unreadable provider responses, or missed reconciliation are failures; preserve typed errors or `reconciliation_required`.
- Deduplicate by Factory item and run identity, not provider comment id.
- Clear bugs reach Builder only through a workflow's Builder step, which enforces the dispatch gate in code (clear bug, low risk, high confidence, no product/UX call, not claimed). The agent never starts Builder work or posts findings itself. Read `review-latest-feedback` for feedback sweeps.
- PR governance follows `review-prs`: verify membership/evidence, skip drafts/external authors, apply the verified `liamdebeasi` exception for ordinary gates, and keep ultra-scary risks manual. Governance approves but never merges; a Builder pull request is merged only by a workflow's merge step, after the merge gate.
- Provider credentials belong to Dispatch/workspace integrations, not Factory. Hosted reads use workspace connections or org vault; local development may use `.env` Slack/GitHub/Sentry keys last.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.

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
| `record-triage-feedback` | Record a person's verdict on a decision |
| `govern-factory-pull-request` | Apply the PR governance gate |
| `list-factory-automations` / `create-factory-automation` / `save-factory-automation` / `run-factory-automation` | Manage agent-run jobs; a workflow's job goes through the workflow actions |
| `describe-workflow-node-catalog` / `save-factory-workflow` / `run-factory-workflow` / `request-workflow-connection` / `set-factory-workflow-enabled` and the other workflow reads | Build, dry-run, connect, enable and inspect workflows; recipe in `factory-workflows`. A failing or odd run: `get-workflow-diagnostics` first |
| `requeue-factory-item` / `dismiss-factory-item` | An item needing a person: retry it (asks approval) or close it |
| `seed-story-run` | Local dev server only, never real work: replays a story's fixtures; `purge` undoes it |
| `read-slack-thread` / `post-slack-message` / `send-factory-email` / `get-factory-pull-request` / `get-factory-merge-gate` / `merge-factory-pull-request` / `list-factory-items` / `create-hubspot-task` | Workflow-only, named by the graph. `_outcome_unknown` errors may have taken effect: check, never retry |
| `run-workflow-operation` | Workflow-only: runs one catalog provider call by `operationId`. Reads retry; writes never do |
| `list-factory-audit` / `get-factory-automation-health` / `reconcile-triage-run` | Queue history, scheduler, monitor observations |
| `list-factories` / `create-factory` / `delete-factory` | Manage factories |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Provider APIs, shared credentials |
| `list-workspace-apps` / `update-workspace-app-metadata` / `list-workspace-resources` / `create-workspace-resource` / `update-workspace-resource` | Manage mounted apps, shared resources |
| `import-agent` / `import-agent-pack` / `list-agent-pack` / `start-workspace-app-creation` | Import profiles/packs and hand off app creation |

Shadow mode is the default; hard guards apply. External mutations need idempotent runs and provider confirmation. Builder hand-off and merge run as workflows; PR governance runs on a scheduled agent job. Listing a factory's workflows or agent jobs pauses its retired seeded agent jobs once (`pausedReason: replaced_by_workflows`); none is deleted. Teammates may edit/run. New automation is a workflow, never `create-factory-automation`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
