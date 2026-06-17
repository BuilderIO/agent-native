---
"@agent-native/core": patch
---

Tool-call journal hard-block: skip re-executing journaled-complete tool calls on
resume. The per-turn tool-call journal (derived from the durable run-event
ledger) previously only added a prompt-level "already completed, don't re-run"
note. The agent loop now enforces this at the tool layer: when a non-read-only
tool call's exact (tool name + input) already completed in an earlier
interrupted chunk of the same turn, `runToolCall` returns the recorded result
instead of re-executing the side effect, while still emitting the normal
tool_start/tool_done so the transcript stays coherent. Fresh calls with no prior
completed journal entry are unaffected.
