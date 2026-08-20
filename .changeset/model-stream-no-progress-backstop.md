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

Background automation failures now also report through `captureError`. Both
callers — the recurring-jobs scheduler and the trigger dispatcher — recorded the
failure onto the automation's own metadata and logged it, and neither reported
it, so a cut-off automation was visible only in a resource field and stdout.

A cut-off run now reports a terminal state instead of none. `runAgentLoop`
returns early at an `auto_continue` checkpoint and never reaches its outcome
classification, so a truncated run shipped `terminal_state` and `error_message`
as null and the reason was recoverable only from `agent_run_events`. Unplanned
boundaries (`no_progress`, `stream_ended`, `gateway_timeout`, …) now surface as a
retryable failure carrying the reason as the terminal code, while the planned
`run_timeout` chunk boundary — which a hosted foreground run hits roughly every
40s by design — records its reason without counting as an error.
