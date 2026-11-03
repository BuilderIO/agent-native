---
"@agent-native/core": patch
---

Agent runs no longer end on `write_tool_outcome_unknown` when a write action rejects its input before anything is saved. The framework now watches the database statements and the HTTP requests (any method but GET, HEAD or OPTIONS) a call sends, so a validation error thrown before the first write lets the agent correct the arguments and retry, while a failure after a write still stops the run; analytics, error reports and model calls do not count as writes. Actions that write somewhere the framework cannot watch, such as a socket, a file or a vendor SDK, call `noteExternalWrite(channel)` before sending, and a write a retry provably cannot repeat can opt out with `withoutWriteObservation`, both from `@agent-native/core/action`.
