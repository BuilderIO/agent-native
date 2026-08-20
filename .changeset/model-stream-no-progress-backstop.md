---
"@agent-native/core": patch
---

Stop the run-level no-progress backstop from killing runs while the model is
still generating. Two watchdogs guarded the same silence on different clocks:
the agent loop's `lastModelStreamProgressAt` bumps on every engine frame, while
the run manager's backstop only sees events the loop forwards. Extended thinking
produces the first without the second, so the 150s bound sat inside the working
distribution — runs whose worst gap crossed it were checkpointed as
`auto_continue { reason: "no_progress" }` and recorded as errors while still
streaming, some missing by a single second, and background automations discarded
results the agent went on to finish minutes later.

The agent loop now brackets each engine call with a `model_stream` start/end
pair, and the run manager counts it exactly like `tool_start`/`tool_done`: an
engine call in flight suspends the backstop, bounded by the loop's own 90s
model-stream watchdog the same way a tool call is bounded by its own timeout.
Keepalives still do not count as progress, so a wedged transport with no engine
call in flight trips the backstop as before.
