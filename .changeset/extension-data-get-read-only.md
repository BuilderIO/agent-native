---
"@agent-native/core": patch
---

Mark `extension-data-get` read-only, so data programs and `run-code` can read an extension's stored data through `appAction`, and MCP hosts no longer treat the read as possibly destructive.
