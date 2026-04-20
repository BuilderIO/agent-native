---
title: "Recurring Jobs"
description: "Cron-scheduled prompts the agent runs on its own — daily digests, weekly reports, hourly polling."
---

# Recurring Jobs

A **recurring job** is a prompt that runs on a cron schedule. It's how the agent does things on its own: "every morning at 7 summarize my overnight emails," "every Monday post last week's signup numbers to Slack," "every hour sweep for stale drafts and delete them."

Jobs live in the [workspace](/docs/resources) at `jobs/<name>.md` — just a Markdown file with YAML frontmatter. No registration, no wiring. Drop the file in and the framework picks it up.

## A job file {#job-file}

```markdown
---
schedule: "0 7 * * *"
enabled: true
runAs: creator
---

# Morning digest

Summarize the emails received overnight. Group by sender domain.
Pin the top 3 threads that look like they need a reply today to the
"Needs reply" label. Draft replies for any that are obvious.
```

That's it. The body is a prompt the agent runs at each scheduled firing. The agent has access to all the same tools and workspace context it has in an interactive chat — actions, skills, memory, connected MCP servers, sub-agents.

## Frontmatter {#frontmatter}

| Field        | Type                          | Default      | Description                                                                                            |
| ------------ | ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `schedule`   | cron expression               | _(required)_ | Standard 5-field cron. `"0 7 * * *"` = every day at 07:00; `"0 */4 * * *"` = every 4 hours.            |
| `enabled`    | boolean                       | `true`       | Flip to `false` to pause without deleting the job.                                                     |
| `runAs`      | `"creator"` \| `"shared"`     | `"creator"`  | `"creator"` runs with the job owner's identity and `ANTHROPIC_API_KEY`. `"shared"` uses the org's key. |
| `createdBy`  | email                         | _(auto)_     | Populated when the job is created through the workspace UI or by the agent.                            |
| `orgId`      | string                        | _(auto)_     | Org scope; inherited from the creator's active org.                                                    |
| `lastRun`    | ISO timestamp                 | _(managed)_  | Written by the scheduler after each run.                                                               |
| `lastStatus` | `"success"` \| `"error"` \| … | _(managed)_  | Latest outcome.                                                                                        |
| `lastError`  | string                        | _(managed)_  | Error message if the last run failed.                                                                  |
| `nextRun`    | ISO timestamp                 | _(managed)_  | Computed from `schedule`; used by the scheduler to decide when to fire next.                           |

The `last*` and `nextRun` fields are written by the scheduler. You can read them to see the history, but don't edit them by hand — the next run will overwrite.

## Cron syntax {#cron}

Standard 5-field cron (minute, hour, day-of-month, month, day-of-week):

| Cron           | Meaning                  |
| -------------- | ------------------------ |
| `*/5 * * * *`  | Every 5 minutes          |
| `0 * * * *`    | Every hour on the hour   |
| `0 */4 * * *`  | Every 4 hours            |
| `0 7 * * *`    | Every day at 07:00       |
| `0 9 * * 1`    | Every Monday at 09:00    |
| `0 17 * * 1-5` | Weekdays at 17:00        |
| `0 0 1 * *`    | First day of every month |

The framework exports `isValidCron()` and `describeCron()` from `@agent-native/core/jobs` if you want to validate or render cron strings in the UI.

## Creating a job {#creating}

### From the Workspace tab

`+` → **Scheduled Task** in the workspace panel. Fill in the prompt and schedule. Saves as `jobs/<slug>.md` and starts running on the next matching tick.

### By asking the agent

> "Create a scheduled task that summarizes my unread emails every morning at 7."

The agent writes the file for you.

### By hand

Drop a Markdown file in `jobs/` via the framework's resource APIs:

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut({
  path: "jobs/morning-digest.md",
  scope: "personal",
  content: `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
});
```

## How the scheduler runs {#how-scheduler-runs}

The scheduler is a framework plugin (`processRecurringJobs()` in `@agent-native/core/jobs`). On each tick it:

1. Lists every enabled `jobs/*.md` resource across all owners.
2. Compares `nextRun` to the current time.
3. For each due job, spins up a fresh agent thread with the job body as the user message.
4. The agent runs its loop — calling actions, writing to SQL, sending A2A messages, emailing, whatever the prompt asks for.
5. On completion, writes `lastRun`, `lastStatus`, `lastError`, and recomputes `nextRun` from the cron.

If the runtime is serverless/edge, trigger the tick from an external cron (Cloudflare Cron Triggers, Vercel Cron, GitHub Actions on a schedule, etc.) by hitting the framework's scheduler endpoint. If you're on Node, the scheduler can run in-process on a `setInterval`.

## Debugging a job {#debugging}

- Open `jobs/<name>.md` in the workspace — the frontmatter shows `lastRun`, `lastStatus`, `lastError`, `nextRun`.
- **Run it now:** ask the agent to "run the `morning-digest` job right now." The agent will invoke the scheduler tool to force-fire it.
- **Pause it:** flip `enabled: false`. The file stays put, just stops running.

## Different from the scheduling package {#vs-scheduling-package}

Don't confuse recurring jobs with `@agent-native/scheduling`:

- **Recurring jobs (this page)** — cron-scheduled _prompts_ the agent runs in the background. Framework-level. Lives in the workspace. Runs on any agent-native app.
- **`@agent-native/scheduling`** — a reusable domain package for building calendar/booking features (event types, availability windows, bookings). Powers the `calendar` and `scheduling` templates. See the scheduling template for usage.

Recurring jobs are "how do I make the agent act on its own?" The scheduling package is "how do I build a calendar app?" Different concerns.

## What's next

- [**Workspace**](/docs/resources) — where jobs live alongside skills, memory, and custom agents
- [**Actions**](/docs/actions) — the tools a job calls
- [**Agent Teams**](/docs/agent-teams) — jobs often spawn sub-agents to do parallel work
