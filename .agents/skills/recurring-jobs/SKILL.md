---
name: recurring-jobs
description: >-
  Legacy scheduled-automation compatibility, organization scope, advanced job
  fields, and cron internals. Use when maintaining manage-jobs integrations or
  debugging the scheduler.
metadata:
  internal: true
---

# Recurring Jobs (Compatibility)

## Rule

Automations are the user-facing umbrella, with **Scheduled** and **Event** as
trigger types. Recurring Jobs is the legacy name and API for scheduled
automations. Jobs live as resource files under `jobs/` with YAML frontmatter
for scheduling metadata.

Prefer the `automations` skill and `manage-automations` for new personal or
organization work. It supports Scheduled and Event triggers, model overrides,
and MCP allowlists. Keep `manage-jobs` for existing schedule-only integrations
and delivery metadata.

## How It Works

1. User asks for something recurring via the agent chat
2. Agent uses `manage-jobs` tool (action: "create") to write a job file at `jobs/<name>.md`
3. A scheduler polls every 60 seconds and finds due jobs
4. Due jobs enter the shared background-automation runner used by event
   automations for identity checks, model and MCP resolution, the agent loop,
   continuation, delivery, usage, and status handling
5. Job results are saved as chat threads

## Connected MCPs in background jobs

Automations can use connected remote MCPs with the same server-side OAuth lifecycle as
interactive chat. When creating a job that needs an MCP, bind the exact
advertised `mcp__<server>__<tool>` names through `mcpTools`. The scheduler
and event dispatcher pass that definition to the shared runner, which resolves
only that allowlist under the persisted creator/org request context. It never
stores or exposes OAuth tokens, URLs, or arbitrary proxy targets. A revoked
connector or missing tool fails the run clearly instead of silently widening
access.

Use an app-owned bounded import/upsert action for writes. Keep provider-specific
response mapping, provenance, deduplication, and write policy in the app rather
than in core. For example, a job can read meeting notes from any connected MCP
and pass normalized action items to an app's idempotent `import` action.

## Job Tool (built in)

| Tool          | Action     | Purpose                                                    |
| ------------- | ---------- | ---------------------------------------------------------- |
| `manage-jobs` | `create`   | Create a recurring job (name, cron schedule, instructions) |
| `manage-jobs` | `list`     | List all jobs and their status                             |
| `manage-jobs` | `update`   | Update schedule, instructions, or toggle enabled           |

## UI Surface

Users can see and manage this work without the agent on the Agent page's
**Automations** tab. The stable compatibility URL remains `/agent#jobs`
(`AgentJobsTab` in `packages/core/src/client/agent-page/`): legacy scheduled
jobs and trigger-aware Scheduled/Event automations support personal and
organization scope. Backed by the scoped list/manage actions — direct users
there instead of describing job files when they just want to view or toggle
scheduled work.

## Key Files

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `packages/core/src/jobs/cron.ts`      | Cron parsing (`nextOccurrence`, `isValidCron`, `describeCron`) |
| `packages/core/src/jobs/scheduler.ts` | Job execution engine (`processRecurringJobs`)            |
| `packages/core/src/jobs/background-automation-runner.ts` | Shared schedule/event execution lifecycle |
| `packages/core/src/jobs/tools.ts`     | Agent tool (`manage-jobs` with create/list/update actions) |

## Related Skills

- `automations` — The primary Scheduled/Event product model
- `actions` — How tools and actions work
- `delegate-to-agent` — How jobs invoke the agent loop
