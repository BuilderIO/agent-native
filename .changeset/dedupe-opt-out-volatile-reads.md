---
"@agent-native/core": patch
---

Opt the built-in `run-code`, `get-code-execution`, and `refresh-screen` tools out of the duplicate read-only tool-call guard via the new `dedupe: false` action option, since polling an execution by id or re-refreshing on-screen state is expected to return a different result on an identical repeat call. Also raise `get-extension` and `get-extension-history-version`'s result cap to 200,000 characters so the generic 50k truncation no longer slices mid-content and corrupts source reads for large extensions.
