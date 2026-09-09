# /stay-within-limits

Keep long-running agent work inside model and account usage windows.

`/stay-within-limits` gives coding agents a lightweight budget loop for broad,
parallel, or multi-hour work. The agent checks current 5-hour and weekly usage,
runs work in bounded waves, and pauses before it crosses the limit instead of
burning through the last usable budget mid-task.

## What It Does

- Checks 5-hour and weekly usage before substantial work and between waves.
- Uses waves of at most 3 parallel subagents by default.
- Pauses new work when either window reaches 95% of its limit.
- Resumes only after re-checking that the actual window or block is clear.
- Makes wake prompts self-contained so work can continue after a long pause.
- Carries the remaining plan, verification steps, and delegation stop
  conditions into the resume prompt.
- Documents the Claude Code-compatible `ccusage` command while allowing host
  usage tools to take priority.

## When To Use It

Use this for long-running coding sessions, PR babysitting, broad reviews,
multi-wave refactors, large research tasks, or any task where parallel agents
could exhaust the current 5-hour or weekly budget.

Skip it for small one-shot edits where checking budget would add more ceremony
than value.

## Claude Code Usage Check

When Claude Code does not expose a better first-party usage signal, use:

```sh
npx -y ccusage@latest blocks --active --json
```

The agent should read the active block start, current usage or cost, and time
remaining. On wake, it should compare the block start timestamp with the
previous check rather than trusting elapsed time alone.

## Resume Pattern

For hosts with a wake/resume tool, the wake prompt should restate the remaining
plan, the 95% pause threshold, the wave throttle, the exact usage check, and the
rule to reschedule if the limit is still too high. If more delegated work
remains, include the next wave's scope, verification commands, and stop
conditions so the resumed agent does not depend on old chat momentum.

For waits longer than an hour, chain wakeups. For budget pauses, preserving the
usage window matters more than keeping the prompt cache warm.

## Install

```sh
npx @agent-native/skills@latest add --skill stay-within-limits --update-instructions
```

Use `--update-instructions` when you want the 5-hour and weekly limit convention
added to `AGENTS.md` or `CLAUDE.md` automatically.
