---
"@agent-native/core": patch
---

Make the chat Stop button actually stop the turn.

A turn runs as a chain of runs: every `loop_limit` / `auto_continue` boundary
and every background handoff starts a successor under a new run id but the same
turn id. Stop only aborted the run id the client happened to hold, so the
successor claimed itself and the agent kept looping — the turn-abort marker that
`isTurnAborted` consults was only ever written on the pre-run path, which is
dead as soon as a run id exists.

`POST /runs/:id/abort` now escalates user-intent reasons (`user`, `abort`,
`user_stuck_cancel`, `user_stuck_retry`) to a turn-wide abort. Watchdog reasons
(`no_progress`, `auto_stuck_retry`) keep single-run semantics so they cannot
kill a server-side continuation chain that is still making progress.
