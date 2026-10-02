---
"@agent-native/core": patch
---

Label `agent_native.telemetry.flush_failures` with `agent_native.telemetry.signal` (`metrics` or `traces`) so a timed-out or failed flush can be attributed to the export that caused it.
