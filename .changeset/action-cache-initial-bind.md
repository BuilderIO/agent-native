---
"@agent-native/core": patch
---

Prevent action queries and denied persisted results from crossing an initial cache binding, and release restore payloads after hydration completes. Block further writes after access denial and order deletion after any storage writes already in flight. Retain trusted first-session preloads without refetching, remove unverified preloads before exposing authenticated UI, and clear denied action results even if cache binding fails. Keep disk revocation active after binding failures, and prevent failed deletions from permitting stale restoration until deletion succeeds.
