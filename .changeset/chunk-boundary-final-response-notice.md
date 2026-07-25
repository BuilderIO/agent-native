---
"@agent-native/core": patch
---

Stop telling users "The agent stopped without sending a final message" while the
agent is still working. A run row at a continuation chunk boundary is also
`status: "completed"`, and SQL run subscriptions synthesized a bare `done` for
it, so a client that reattached past the boundary event concluded the turn had
ended while the chained successor run was still going. Subscriptions now re-emit
the run's real terminal event (or an `auto_continue` derived from its
`terminal_reason`) so the client keeps following the turn. The chat notice also
waits for the stopped-without-text state to hold for a beat, so transport
re-attach gaps no longer flash it.
