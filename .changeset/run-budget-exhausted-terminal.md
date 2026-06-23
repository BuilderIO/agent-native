---
"@agent-native/core": patch
---

When a hosted run is cut off mid-step and exhausts its in-invocation
continuation budget without finishing, the chat now ends with a loud,
unambiguous "stopped before finishing" terminal instead of a silent stall or a
misleading clean `done`. The terminal carries a machine-readable
`run_budget_exhausted` error code that is deliberately excluded from the
client's auto-recoverable allow-list, so the chain terminates rather than
looping another continuation into the same wall, and any half-streamed partial
text is cleared so the message stands alone.
