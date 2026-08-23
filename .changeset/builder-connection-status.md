---
"@agent-native/core": patch
---

Fix the Builder connection-status route's OAuth-custody branch silently reporting a failed key-pair lookup the same way as confirmed-absent keys, by resolving the detailed credential lookup and surfacing a distinct `keyLookupFailed` flag.
