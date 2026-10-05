---
"@agent-native/core": patch
---

Record `error.type="suspended"` on `agent_native.telemetry.flush_failures` when the flush timer fires well past its deadline, which means the runtime froze the process mid-flush rather than the export being slow.
