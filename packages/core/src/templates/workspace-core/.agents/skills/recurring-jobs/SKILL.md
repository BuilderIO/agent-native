---
name: recurring-jobs
description: >-
  Scheduled tasks the agent runs on a cron schedule. Use when a user asks for
  something recurring ("every morning", "daily", "weekly"), when creating or
  updating jobs, or when debugging the job scheduler.
metadata:
  internal: true
---

# Recurring Jobs

## Rule

Recurring jobs are scheduled tasks the agent executes automatically on a cron schedule. Jobs live as resource files under `jobs/` with YAML frontmatter for scheduling metadata.

## How It Works

1. User asks for something recurring via the agent chat
2. Agent uses `manage-jobs` tool (action: "create") to write a job file at `jobs/<name>.md`
3. A scheduler polls every 60 seconds, finds due jobs, and executes them via `runAgentLoop`
4. Job results are saved as chat threads

## Connected MCPs in background jobs

Jobs can use connected remote MCPs with the same server-side OAuth lifecycle as
interactive chat. When creating a job that needs an MCP, bind the exact
advertised `mcp__<server>__<tool>` names through `mcpTools`. The scheduler
resolves only that allowlist under the job's persisted user/org request
context; it never stores or exposes OAuth tokens, URLs, or arbitrary proxy
targets. A revoked connector or missing tool fails the run clearly instead of
silently widening access.

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

Users can see and manage jobs without the agent on the Agent page's Jobs tab
(`/agent#jobs`, `AgentJobsTab` in `packages/core/src/client/agent-page/`):
recurring jobs (personal and organization scope) with pause/resume/delete and
run status, plus automations (personal-only today). Backed by the scoped
list/manage actions in `packages/core/src/jobs/actions/` — direct users there
instead of describing job files when they just want to view or toggle jobs.

## Key Files

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `packages/core/src/jobs/cron.ts`      | Cron parsing (`nextOccurrence`, `isValidCron`, `describeCron`) |
| `packages/core/src/jobs/scheduler.ts` | Job execution engine (`processRecurringJobs`)            |
| `packages/core/src/jobs/tools.ts`     | Agent tool (`manage-jobs` with create/list/update actions) |

## Related Skills

- `actions` — How tools and actions work
- `delegate-to-agent` — How jobs invoke the agent loop
