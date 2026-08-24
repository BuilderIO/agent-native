---
"@agent-native/core": patch
---

Report `$ai_stop_reason` on each generation, and stop discarding an oversized trace payload wholesale. The engine already knew why every model call ended (`end_turn`, `tool_use`, `max_tokens`, …) and never passed it on, so a truncated answer was indistinguishable from a finished one; the `model_stream` close event now carries it. Content over the 128KB ceiling used to be replaced entirely by a placeholder — a 244KB conversation left nothing at all in the trace. A message list is now cut from the front, keeping as many of the newest turns as fit behind a marker naming what was dropped, and tool definitions fall back to names-only (`tool_definitions_trimmed`) before being dropped. `input_truncated` / `output_truncated` still mark anything cut, so a partial payload can never read as a complete one.
