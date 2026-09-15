---
"@agent-native/core": patch
---

Fix agent runs that ended as "Interrupted before this finished reporting" plus
"The agent stopped without sending a final message" when nothing had actually
gone wrong. Both are what the client renders when a run's SSE stream closes
with no terminal frame, and two paths could do that. The SQL (cross-isolate)
subscription treated any non-`running` run it did not have a branch for as a
finished turn: a missing `agent_runs` row — pruned by retention, not yet
committed, or read from a lagging replica — and any unrecognized `status` value
both fell through to a silent `controller.close()`. The in-memory subscription
closed the same way on reconnect during the window where `run.status` has
flipped to `completed` but the completion callback has not yet emitted the
terminal event.

A subscriber now always leaves with a terminal frame. A missing row is retried
for a grace period before being reported, so an ordinary startup race no longer
ends the turn; after that it reports the typed, recoverable
`run_record_missing`, and an unrecognized status reports `unknown_run_status`.
A terminal-event lookup that fails to read reports `run_terminal_lookup_failed`
rather than either of those, so "we looked and there is nothing" stays separable
from "we could not look". All three prefer the run's real persisted terminal
event when one exists and are captured for triage, and none auto-continues: the
outcome is unknown, so an automatic re-POST could replay side effects that
already landed. They surface with a manual Retry instead. The in-memory path
waits briefly for the producer's real terminal event instead of closing, replays
a buffered terminal event when the subscriber's cursor is already past it, and
fails loudly if the event never arrives.
