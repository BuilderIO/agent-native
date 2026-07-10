---
"@agent-native/core": patch
---

Recover background chat turns whose continuation handoff dispatch failed instead of failing them immediately: the pre-inserted successor run is left claimable so the unclaimed-run sweep can redispatch it (and the client poll defers to that sweep within a bound), backed by a backstop that still fails loud if the handoff never lands.

Operational note — terminal-reason change: when a continuation handoff exhausts its dispatch retry budget but the successor row exists, the run's `terminal_reason` is now `background_continuation_dispatch_deferred` (recoverable, awaiting sweep redispatch) instead of `background_continuation_dispatch_failed`. The old `background_continuation_dispatch_failed` reason is still emitted, but now only in the narrower case where the successor row itself could not be pre-inserted. Any dashboards, alerts, or audit queries matching `background_continuation_dispatch_failed` should add `background_continuation_dispatch_deferred` to keep covering this failure class.
