---
name: incident-investigation
description: >-
  Investigate a named user's session, error, stuck agent run, or replay evidence. Use for what a user did, why something failed for them, or what they typed.
---

# Incident Investigation

Use the first-party observability actions instead of generic SQL. These
read-only investigation tools remain available in Plan mode; run the query
instead of deferring it to execution mode. Load any that are not callable yet
with one `tool-search` call naming all of them.

## A Named User's Session Or Error

1. Resolve the user's email from context, then call `list-session-recordings`
   with `userId` over a bounded recent window to find the relevant sessions. Do
   not require `hasErrors=true` for this initial lookup: replay, network, and
   stuck-run evidence can exist while the recording's JavaScript `errorCount` is
   zero. Use `hasErrors=true` only when the user asks for recordings with
   captured JavaScript errors or the recording metadata confirms the filter is
   appropriate.
2. Call `list-error-issues` with `userId` or `sessionRecordingId` to find a
   grouped issue, then `get-error-issue` for stack, breadcrumbs, occurrences, and
   linked recordings.
3. For console diagnostics or failed network requests, call
   `create-session-replay-agent-link` first and use its scoped diagnostics
   endpoint for detailed error text, stacks, request metadata, and bounded 5xx
   snippets; enumerate with `kind`/`limit` and `fromMs`/`toMs` or `offset` when
   needed.
4. Use `get-session-replay-summary` and `get-session-replay-timeline` for the
   page-navigation and click sequence, and `get-session-replay-events` only for
   additional bounded replay-event details.
5. If no grouped error exists, correlate first-party observability events such as
   `agent_chat_stuck_detected` with `query-agent-native-analytics`.

Report the matching evidence. Do not claim a root cause without a corroborating
error, event, or replay signal.

## Prompt And Behavior Evidence

When a connected MCP exposes behavioral analytics or session replay, use it for
qualitative product questions: start with an aggregate or bounded customer
cohort, inspect a documented-limit sample of sessions, then read event
transcripts and request screenshots or accessibility evidence when available.
Treat explicitly typed user text as the prompt; keep generated suggestions,
agent responses, and UI labels separate. Report session and user counts, sample
bounds, masking or redaction, replay and screenshot availability, and source
gaps. Never claim a visual was inspected unless the tool returned it.

## Listing And Filtering Sessions

- `list-session-recordings` filters scoped replays by date, app, duration,
  signals, visitor type, and email domain. Use `paginated: true` for sorted pages
  with a real total and app counts; the default returns an array.
- With the Sessions triage Lab on, `didEvents` / `didNotEvents` filter by tracked
  events and `slow` by speed. Get real names and session counts from
  `list-session-event-names`, and event health from `list-event-catalog`. Both
  read Analytics' own index, which covers sessions only from its coverage start.
  Never query BigQuery for these views.
