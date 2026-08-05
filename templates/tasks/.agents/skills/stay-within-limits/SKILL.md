---
name: stay-within-limits
description: Use when long-running or parallel agent work must respect 5-hour and weekly usage limits by checking usage between waves, pausing near the cap, and resuming only when the window is clear.
---

# Stay Within Limits

Keep long-running agent work inside the current 5-hour and weekly usage windows.
Check usage before launching substantial work and between waves of parallel
subagents. If an active 5-hour or weekly limit is at or above 95%, pause new
work until the window is clear enough to continue safely.

## Core Loop

1. Run a bounded wave of work. Default to at most 3 parallel subagents unless
   the user or host gives a different throttle.
2. Wait for the wave to finish. Do not interrupt in-flight subagents just to
   save budget; that usually loses work.
3. Check current 5-hour and weekly usage with the host's usage/budget tool.
4. If either window is at or above 95%, stop launching work and schedule a
   self-contained resume when the relevant window should clear.
5. On resume, re-check the real window or block before continuing. Do not trust
   elapsed wall-clock time alone.

## Usage Signals

Prefer a first-party host usage tool when available. In Claude Code, use:

```sh
npx -y ccusage@latest blocks --active --json
```

Use the JSON to identify the active block start, current cost or percentage, and
time remaining. On wake, compare the active block start timestamp with the
previous one; a new timestamp is stronger evidence than "enough time passed."

If the tool reports cost instead of a direct percentage, convert through the
current account limit when known. For Claude Max-style 5-hour blocks, some users
prefer an earlier caution threshold around $500-550; treat that as a
user-configured guardrail, not a universal rule. The default stop rule is still
95% of the active 5-hour or weekly limit.

## Pausing And Resuming

When a wake/resume tool is available, schedule a wakeup for:

```txt
min(3600, secondsUntilWindowClears)
```

If the runtime clamps wake delays to 60-3600 seconds, chain wakeups for longer
waits. Each wakeup should re-check usage, reschedule if still over budget, and
continue only when the window is safely below the threshold.

Make wake prompts self-contained. Include:

- The remaining plan.
- The check-then-reschedule rule.
- The 95% threshold and wave throttle.
- The exact usage command or host usage tool to run.
- The previous block/window identifier when available.
- The next verification steps.
- The next wave's handoff packets, including scope, verification commands, and
  stop conditions, if delegation will resume.

## Choosing The Wait Mechanism

- Use a wake/resume tool when the agent needs instructions attached to the
  future resume.
- Use a background sleep or watcher for fixed timers and things a process can
  observe directly.
- Use cron or recurring schedules only for recurring fresh-session work.

Avoid short-interval polling for things the host will notify you about, such as
background task or subagent completion. For budget pauses, a prompt-cache miss
after a long sleep is acceptable; preserving the limit matters more.

## Reporting

If you pause, tell the user which window is over threshold, the observed usage,
when you scheduled or expect the next check, and what work remains. Keep enough
state in the wake prompt that the next turn can resume without relying on
conversation momentum.
