---
"@agent-native/core": patch
---

Prevent action queries and denied persisted results from crossing an initial cache binding, and release restore payloads after hydration completes. Block further writes after access denial and order deletion after any storage writes already in flight.
