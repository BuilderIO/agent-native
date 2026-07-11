---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Prevent sync-driven request storms by preserving in-flight reads, filtering same-tab action echoes, targeting action-query invalidation, refreshing shared run state from change events, and backing idle Dispatch monitoring away from fixed polling.
