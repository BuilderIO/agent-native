---
"@agent-native/core": patch
---

Opt the dedicated `get-code-execution` and `refresh-screen` volatile reads out of the duplicate read-only tool-call guard via the new `dedupe: false` action option while retaining default duplicate protection for normal `run-code` executions. Also raise `get-extension` and `get-extension-history-version` result caps to 500,000 and 2,000,000 characters respectively so JSON serialization overhead cannot slice mid-content and corrupt source reads for large extensions or their history.
