---
"@agent-native/toolkit": patch
---

A non-lead collaborative editor no longer adopts a newer snapshot over a live document that already holds typing the snapshot predates. The lead-failover adoption deleted a collaborator's concurrently typed text for every peer, because a peer's save lags the shared Yjs state.
