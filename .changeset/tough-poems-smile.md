---
"@agent-native/core": patch
---

Stop a background turn from retrying an identical failure forever. When two
consecutive server-driven continuation chunks end on the same terminal error
code having produced no assistant text and no tool calls, the chain now stops
and the run ends with one non-recoverable error that keeps the original error
code and the gateway's `ERROR ID:` reference. A different error, or the same
error after real progress, still chains as before.
