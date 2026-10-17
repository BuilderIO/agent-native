---
"@agent-native/core": patch
---

Reset chat history rows, loading, errors, and paging synchronously when the list identity changes, and retire previous list handlers before passive effects. Preserve loaded rows and offsets when a refresh of the same list fails.
