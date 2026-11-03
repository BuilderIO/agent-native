---
"@agent-native/core": patch
---

Agent runs no longer end on `write_tool_outcome_unknown` when a write action rejects its input before anything is saved. The framework now watches the database statements a call sends, so a validation error thrown before the first write lets the agent correct the arguments and retry, while a failure after a write still stops the run. Actions that write somewhere the framework cannot watch, such as a provider API or object storage, call `noteExternalWrite(channel)` from `@agent-native/core/action` before sending.
