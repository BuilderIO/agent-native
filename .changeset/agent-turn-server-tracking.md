---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

An agent run ended by a SQL write now sends its one `agent_run_terminal` too: runs the server reaps (`reaped: true`), stopped runs (`status: "aborted"`), runs the reaper repairs from their event log, and runs that fail or are released before their worker starts. The event carries `turn_id` and the run's user. An aborted run is reported by the SQL write that stopped it, so aborted events no longer carry `model`, `engine` or `attempt_count`. `run_started` also carries `turn_id`, and so do `$ai_trace` and `$ai_generation` for agent chat runs.

The browser now sends `agent_turn_submitted` once per agent request it submits and the server accepts (not yet for a queued message the server's inbox drain admits), with the same `turn_id`, `initiator` (`user`, `app`, or `system`) and `surface`; continuations repeat the turn's `turn_id` as `system`. `agent_run_outcome` now carries `turn_id`. See the tracking skill for the full contract.
