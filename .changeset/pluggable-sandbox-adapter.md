---
"@agent-native/core": minor
---

Add a pluggable sandbox-adapter seam for the `run-code` tool. The
code-execution sandbox now runs behind a `SandboxAdapter` interface so the
execution backend can be swapped without changing agent code, the localhost
bridge, the env scrub, or output formatting. The default
`LocalChildProcessAdapter` preserves the existing spawned child-process behavior
byte-for-byte. A different backend (e.g. a Docker or remote/durable runner) can
be plugged in via `registerSandboxAdapter()` or the `AGENT_NATIVE_SANDBOX` env
var — the documented lever for exceeding the hosted execution ceiling on long
jobs.
