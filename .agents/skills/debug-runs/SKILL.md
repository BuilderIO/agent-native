---
name: debug-runs
description: >-
  Find and read the agent chat runs behind a run id, a user's email, or an
  object id or link (deck, design, dashboard, document, plan, recording, …)
  in any app, then work out what failed or why the object looks the way it
  does. Use when someone reports a broken chat, a failed run, or a bad
  result and gives you any of those instead of a thread.
scope: dev
metadata:
  internal: true
---

# Debug Runs

`scripts/debug-runs.ts` reads production app databases (read-only, one
transaction per query) and turns a run id, email, or object id into the chats
and runs that touched it, with the full conversation.

It needs `<APP>_DATABASE_URL` entries in the repo-root `.env` or
`DATABASE_URL` in `templates/<app>/.env`. A worktree without its own `.env`
falls back to the main checkout's. An app whose credentials fail shows up as an `error`
entry; it was not searched, which is not the same as "nothing found".

## 1. Find the runs

```bash
pnpm exec tsx scripts/debug-runs.ts find <input> [--app NAME] [--days 30] [--limit 20]
```

| Input | Example | How it is matched |
|---|---|---|
| Run id | `run-1700000000000-example` | live `agent_runs`/traces, else the thread active at the timestamp inside the id |
| Email | `user@example.com` | threads they own, plus their MCP/A2A calls |
| Object link | `https://slides.agent-native.com/deck/EXAMPLE_deck1` | app from the host, id from the path |
| Bare object id | `EXAMPLE_design1` | every app: thread scope, owner lookup, owner's threads, audit inputs |

Prefer the link over a bare id: it searches one app and also scans that app's
audit log even when the object was deleted. `--app` does the same for a bare
id.

Each `results[]` entry is one app:

- `owners`: the table the object lives in and its owner.
- `threads[]`: `matchedBy`, title, owner, scope, and `runs[]` with status,
  error, model, and timing.
- `externalAgentSessions`: calls from Claude Code, Codex, ChatGPT, and other
  MCP/A2A clients, grouped by client with 30-minute gaps. Their conversation
  lives in that client; only the calls reached us.
- `uiSessions`: audited UI edits to the object outside any chat.
- `auditError`: the audit scan timed out; rerun with a smaller `--days`.

## 2. Read a thread

```bash
pnpm exec tsx scripts/debug-runs.ts show <runId | threadId> [--app NAME]
```

This writes `.tmp/debug-runs/<app>-<threadId>.md` and a `.json` beside it.
The `.md` has the run list, live run rows, terminal run events, failed trace
spans, versions the thread wrote, audited actions, and the transcript: user
messages, assistant text, reasoning, and every tool call with its arguments
and result. Long values are capped in the `.md`; the `.json` has them whole,
plus the raw `thread_data`, including `_debugPrompts`, the system prompt of
each run.

## 3. Diagnose

**What failed.** Start at the failed run's `error`, then the last tool call
before it. `result: (none recorded…)` means the run died inside that call.
Then check the terminal event and failed spans, if they are still retained. A
`runs[].screen` value is what the user was looking at when the run started.
For a provider `ERROR ID`, search Sentry (the `sentry-cli` skill) by the
user's email and the run's time window; run and thread ids sit in event
extras, not tags.

**Why it looks like this.** The "versions written by this thread" section
links each saved version to its `runId`/`turnId`, in apps that keep versions
(Analytics, Content, Design, Plan, Slides). Diff the version before and after
the run in that app's versions table. Elsewhere, follow the mutating tool
calls on the object in order. `uiSessions` and `externalAgentSessions` show
edits that came from outside this chat.

## Retention

| Data | Kept |
|---|---|
| `chat_threads.thread_data` (the full conversation) | until the user deletes the chat |
| `agent_runs`, `agent_run_events` | 24h after success, 7 days after an error |
| `agent_trace_spans`, `agent_trace_summaries` | 30 days |
| `agent_audit_log` | 365 days |

A deleted chat is gone; its audit rows remain. Threads created before May 2026
have no run ids, so `runs[]` is empty and only the transcript is available.

## Rules

- This is customer data. Keep it in `.tmp/`. Never paste transcripts, emails,
  or object contents into GitHub, Slack, Jira, or commits; summarize the cause
  and cite ids.
- For ad-hoc SQL beyond the script, stay read-only and never `LIKE` across
  `chat_threads.thread_data` without an `owner_email` or time filter. Design's
  table alone is over 1 GB, and an unfiltered scan times out against
  production.
