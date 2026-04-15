---
name: recurring-jobs
description: >-
  Scheduled tasks the agent runs on a cron schedule. Use when a user asks for
  something recurring ("every morning", "daily", "weekly"), when creating or
  updating jobs, or when debugging the job scheduler.
---

# Recurring Jobs

## Rule

Recurring jobs are scheduled tasks the agent executes automatically on a cron schedule. Jobs live as resource files under `jobs/` with YAML frontmatter for scheduling metadata.

## How It Works

1. User asks for something recurring via the agent chat
2. Agent uses `create-job` tool to write a job file at `jobs/<name>.md`
3. A scheduler polls every 60 seconds, finds due jobs, and executes them via `runAgentLoop`
4. Job results are saved as chat threads

## Job Tools (built in)

| Tool         | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `create-job` | Create a recurring job (name, cron schedule, instructions) |
| `list-jobs`  | List all jobs and their status                             |
| `update-job` | Update schedule, instructions, or toggle enabled           |

## Key Files

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `packages/core/src/jobs/cron.ts`      | Cron parsing (`nextOccurrence`, `isValidCron`, `describeCron`) |
| `packages/core/src/jobs/scheduler.ts` | Job execution engine (`processRecurringJobs`)            |
| `packages/core/src/jobs/tools.ts`     | Agent tools (`create-job`, `list-jobs`, `update-job`)    |

## Related Skills

- `actions` — How tools and actions work
- `delegate-to-agent` — How jobs invoke the agent loop
