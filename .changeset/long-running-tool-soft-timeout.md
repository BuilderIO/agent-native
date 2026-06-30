---
"@agent-native/core": patch
---

Don't cut long-running tools at the 40s run soft-timeout in durable background
workers. An action that declares a `timeoutMs` longer than the default tool
budget (e.g. a 12-min image generation) now extends the run's soft-timeout
deadline to cover the in-flight tool, clamped to the background-function ceiling
(~13 min). Previously `resolveRunSoftTimeoutMs` clamped the worker's budget back
to 40s whenever the `-background` runtime wasn't detected, so the run emitted
`auto_continue` and abandoned the tool mid-execution — the model saw "Interrupted
before this tool returned a result." and retried while the work kept running as a
zombie. The guard is scoped to the durable-background worker (15-min Netlify
budget); the interactive/foreground synchronous path keeps its 40s graceful
auto_continue + interrupted-tool ledger recovery unchanged.
