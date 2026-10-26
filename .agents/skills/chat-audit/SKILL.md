---
name: chat-audit
description: >-
  Find every chat a user touched, by email, deck link, thread, or run id, and
  walk its runs to see what happened. Use when debugging a user's report ("my
  chat disappeared", "the deck agent failed"), when you only have an email or
  deck link and no run id, or when triaging a run's errors across a session.
scope: dev
metadata:
  internal: true
---

# Chat audit

Use `pnpm action audit-chats` to map an email or deck link to chats, then to
their runs. Start here whenever the user does not have a run id, which is most
of the time: chats vanish and windows close.

## Query

```bash
pnpm action audit-chats --email alice@example.com --format json
pnpm action audit-chats --deck https://app.example.com/decks/abc123 --format json
pnpm action audit-chats --run <run-id> --format json
pnpm action audit-chats --thread <thread-id> --format json
```

- `--email` matches chats the address owns **or** sent a turn in
  (`agent_turn_initiators`). Chats a user only typed into still show up.
- `--deck` takes a URL or a bare id. It matches the attached scope id, the
  source URL, and any message text, so a deck pasted into a chat is found.
- Results are ordered newest-first; `--limit` defaults to 20.
- Filters combine with OR. Pass one at a time unless you want the union.

Run it from the app directory whose database holds the data. It is read-only.
It deliberately reads across all owners, so do not expose it through a route.

## Read the output

Each chat lists its runs, newest-first. For each run:

- `status`: `completed`, `error`, `running`, and so on.
- `terminalReason` / `errorCode`: why a run ended. Start with these.
- `initiatorEmail`: who sent the turn. This is the "user session" link when the
  chat belongs to someone else.
- `dispatchMode`: `background` runs are the ones that outlive the browser tab.

## Go deeper

1. Pick the run to investigate from the status and error fields.
2. Read its events in order:
   `SELECT seq, event_at, event_data FROM agent_run_events WHERE run_id = '<run-id>' ORDER BY seq;`
3. For errors that reached Sentry, search the run id or thread id there.
4. For a run stuck in `running`, check `diag_stage`, `heartbeat_at`, and
   `last_progress_at` on the `agent_runs` row.

## Gotchas

- A deck id that appears only in message text is a weaker match than a
  `scope` match. Say so when reporting.
- Matching on email is case-insensitive. If nothing comes back, confirm the
  address spelling before concluding the user has no chats.
- Message bodies and event payloads can contain customer data. Summarize them
  rather than pasting them into shared channels.
