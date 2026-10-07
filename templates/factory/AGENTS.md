# Factory

Factory is a workspace of named factories: Inbox, automations, and a reviewable
map. Dispatch owns shared inbox routing. Factory owns queue state, rules, jobs,
and graph versions.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/factory-graphs/SKILL.md` — for Map, node, route, or graph-version work.
- `.agents/skills/turn-into-app/SKILL.md` — to promote a proven workflow into an app.
- `.agents/skills/turn-into-skill/SKILL.md` — to capture a workflow as a reusable skill.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/review-latest-feedback/SKILL.md`,
`.agents/skills/review-prs/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Keep app state in SQL via Drizzle, scope reads/writes by org and member, and use actions for UI, agent, CLI, MCP, and A2A.
- Missing callbacks, partial threads, unreadable provider responses, or missed reconciliation are failures; preserve typed errors or `reconciliation_required`.
- Deduplicate by Factory item and rule/run identity, not provider comment id.
- Slack clear bugs use `dispatch-factory-item`; never post Slack messages or `@handles`. GitHub issues and Sentry tag `@builderio-bot` on a GitHub issue. Read `review-latest-feedback`; include `risk` and `confidence`.
- PR governance follows `review-prs`: verify membership/evidence, skip drafts/external authors, apply the verified `liamdebeasi` exception for ordinary gates, keep ultra-scary risks manual, and never auto-merge.
- Graph edits create immutable blueprint versions. AI proposes with `source=ai`; a person reviews/publishes through actions.
- Provider credentials belong to Dispatch/workspace integrations, not Factory. Hosted reads use workspace connections or org vault; local development may use `.env` Slack/GitHub/Sentry keys last.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.

## Application state

- `navigation.view` is `factory` or `agents`. No `factoryId` means the factory
  list. Opening a factory defaults to Inbox. `view-screen` matches the visible
  tab; read `factory-graphs` only for Map edits.

## Actions

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` | Queue reads |
| `get-triage-config` / `save-triage-config` | Factory config |
| `poll-slack-channel` / `get-slack-feedback-context` | Slack evidence |
| `poll-github-sources` / `poll-sentry-errors` / `ingest-github-observation` | Bounded source evidence |
| `list-triage-rules` / `save-triage-rule` / `evaluate-triage-item` / `record-triage-feedback` | Tune rules, record decisions/corrections |
| `dispatch-factory-item` / `govern-factory-pull-request` | Apply issue/PR gates |
| `babysit-factory-pull-request` / `propose-pr-babysit-status` | Ping bot PR / read briefing |
| `list-factory-automations` / `create-factory-automation` / `save-factory-automation` / `run-factory-automation` | Manage jobs |
| `list-factory-audit` / `get-factory-automation-health` | Queue history / scheduler |
| `suggest-factory-rules` / `reconcile-triage-run` | Propose rules / persist monitor observations |
| `list-factories` / `get-factory-graph` / `delete-factory` / `create-factory` / `save-factory-graph` | Manage factories and versioned Maps |
| graph history actions | Inspect or restore graph versions |
| `list-factory-comments` / `add-factory-comment` | Read/add canvas, node, or edge comments |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Call provider APIs with shared credentials |
| `list-workspace-apps` / `update-workspace-app-metadata` | Manage mounted apps |
| `list-workspace-resources` / `create-workspace-resource` / `update-workspace-resource` | Manage shared resources |
| `import-agent` / `import-agent-pack` / `list-agent-pack` / `start-workspace-app-creation` | Import profiles/packs and hand off app creation |

Rules default to shadow mode; hard guards apply. External mutations need idempotent runs and provider confirmation. Polling/Builder/PR dispatch runs on scheduled jobs; teammates may edit/run. Use `create-factory` to open Inbox, `create-factory-automation` for jobs, and `save-factory-graph` for Maps; AI cannot rename. Edit rules via triage actions, not graph JSON.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
