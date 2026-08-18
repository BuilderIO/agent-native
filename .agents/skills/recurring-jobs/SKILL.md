---
name: recurring-jobs
description: >-
  The legacy manage-jobs compatibility surface, job files under jobs/, and cron
  scheduler internals. Use when maintaining manage-jobs integrations or
  debugging the scheduler.
metadata:
  internal: true
---

# Recurring Jobs (Compatibility)

## Rule

Recurring Jobs is the legacy name and API for scheduled automations. Jobs live
as resource files under `jobs/` with YAML frontmatter for scheduling metadata.

Read `automations` for the product model, trigger types, frontmatter fields,
organization scope, and when to prefer `manage-automations` over `manage-jobs`.
This skill covers only what is specific to the legacy scheduled path: the
`manage-jobs` tool and the cron scheduler behind it.

## How It Works

1. User asks for something recurring via the agent chat
2. Agent uses `manage-jobs` tool (action: "create") to write a job file at `jobs/<name>.md`
3. A scheduler polls every 60 seconds and finds due jobs
4. Due jobs enter the shared background-automation runner, on the same
   execution lifecycle as event automations
5. Job results are saved as chat threads

## Connected MCPs in background jobs

When a job needs a connected remote MCP, bind the exact advertised
`mcp__<server>__<tool>` names through `mcpTools`. The scheduler passes that
definition to the shared runner, which resolves only that allowlist under the
persisted creator/org request context and never stores or exposes OAuth tokens,
URLs, or arbitrary proxy targets.

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

`/agent#jobs` is the stable compatibility URL for the Agent page's
**Automations** tab, which lists legacy scheduled jobs alongside trigger-aware
automations and is backed by the scoped list/manage actions. Direct users there
instead of describing job files when they just want to view or toggle scheduled
work.

## Key Files

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `packages/core/src/jobs/cron.ts`      | Cron parsing (`nextOccurrence`, `isValidCron`, `describeCron`) |
| `packages/core/src/jobs/scheduler.ts` | Job execution engine (`processRecurringJobs`)            |
| `packages/core/src/jobs/tools.ts`     | Agent tool (`manage-jobs` with create/list/update actions) |
| `packages/core/src/client/agent-page/` | `AgentJobsTab`, the `/agent#jobs` surface                |

## Related Skills

- `automations` — The primary Scheduled/Event product model
- `actions` — How tools and actions work
- `delegate-to-agent` — How jobs invoke the agent loop
