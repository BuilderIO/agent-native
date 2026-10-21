---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

An agent run ended by a SQL write now sends its one `agent_run_terminal` too: runs the server reaps (`reaped: true`), runs a user stops (`status: "aborted"`), runs the reaper repairs from their event log, and runs that fail or are released before their worker starts. The event carries `turn_id` and the run's user. `run_started`, `$ai_trace` and `$ai_generation` also carry `turn_id`.

The browser now sends `agent_turn_submitted` once per agent request the server accepts, with the same `turn_id`, `initiator` (`user`, `app`, or `system`) and `surface`; continuations repeat the turn's `turn_id` as `system`. `agent_run_outcome` now carries `turn_id`. See the tracking skill for the full contract.
