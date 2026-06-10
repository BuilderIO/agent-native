---
title: "Recurring Jobs"
description: "Cron-scheduled prompts the agent runs on its own — daily digests, weekly reports, hourly polling."
---

# Recurring Jobs

A **recurring job** is a prompt that runs on a cron schedule. It's how the agent does things on its own: "every morning at 7 summarize my overnight emails," "every Monday post last week's signup numbers to Slack," "every hour sweep for stale drafts and delete them."

Recurring jobs fire on a clock. To react to _events_ (a booking created, an email received) — same `jobs/` file format plus conditions — see [Automations](/docs/automations).

Jobs live in the [workspace](/docs/workspace) at `jobs/<name>.md` — just a Markdown file with YAML frontmatter. No registration, no wiring. Drop the file in and the framework picks it up.

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

The framework includes cron utilities (`isValidCron()` and `describeCron()`) for validating and rendering cron strings, used internally by the resource and scheduler layers.

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

await resourcePut(
  ownerEmail,
  "jobs/morning-digest.md",
  `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
);
```

## How the scheduler runs {#how-scheduler-runs}

The scheduler is a framework plugin (the internal `processRecurringJobs()` routine). On each tick it:

1. Lists every enabled `jobs/*.md` resource across all owners.
2. Compares `nextRun` to the current time.
3. For each due job, spins up a fresh agent thread with the job body as the user message.
4. The agent runs its loop — calling actions, writing to SQL, sending A2A messages, emailing, whatever the prompt asks for.
5. On completion, writes `lastRun`, `lastStatus`, `lastError`, and recomputes `nextRun` from the cron.

The scheduler runs in-process: a `setInterval` fires every 60 seconds (with a 10-second startup delay) inside the agent chat plugin, wherever the server is running. On scale-to-zero serverless hosts, jobs only fire while an instance is warm — if reliable scheduling matters, keep an instance warm with keep-alive pings or use an always-on host (Fly, Render, a VPS).

## Debugging a job {#debugging}

- Open `jobs/<name>.md` in the workspace — the frontmatter shows `lastRun`, `lastStatus`, `lastError`, `nextRun`.
- **Test it without waiting:** there's no force-fire tool. To exercise the same work on demand, either paste the job's prompt into the agent chat and let it run there, or temporarily set the schedule to the next minute so the scheduler picks it up on the next tick (then restore the real cron).
- **Pause it:** flip `enabled: false`. The file stays put, just stops running.

## Agent tool {#agent-tool}

A single `manage-jobs` tool is registered in every template. The `action` parameter selects the operation:

| Action   | Parameters                                                        | Purpose                                                      |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `create` | `name`, `schedule`, `instructions` (required); `scope`, `runAs`   | Create a new recurring job                                   |
| `list`   | `scope` (`personal`, `shared`, or all)                            | List all jobs with status (schedule, enabled, last/next run) |
| `update` | `name` (required); `schedule`, `instructions`, `enabled`, `runAs` | Edit an existing job                                         |
| `delete` | `name` (required)                                                 | Delete a job — always confirm with the user first            |

**Personal vs shared scope.** Each job lives in either personal scope (runs as and is visible only to the creator) or shared/org scope (runs on behalf of the creator but is visible to org members). The `scope` and `runAs` parameters control this at create time. Org admins can update or delete any shared job; non-admin members can only manage their own.

## Different from the scheduling package {#vs-scheduling-package}

Don't confuse recurring jobs with `@agent-native/scheduling`:

- **Recurring jobs (this page)** — cron-scheduled _prompts_ the agent runs in the background. Framework-level. Lives in the workspace. Runs on any agent-native app.
- **`@agent-native/scheduling`** — a reusable domain package for building calendar/booking features (event types, availability windows, bookings). Powers the `calendar` template and custom scheduling surfaces.

Recurring jobs are "how do I make the agent act on its own?" The scheduling package is "how do I build a calendar app?" Different concerns.

## What's next

- [**Automations**](/docs/automations) — add event triggers and conditions to the same `jobs/` format
- [**Workspace**](/docs/workspace) — where jobs live alongside skills, memory, and custom agents
- [**Actions**](/docs/actions) — the tools a job calls
- [**Agent Teams**](/docs/agent-teams) — jobs often spawn sub-agents to do parallel work
