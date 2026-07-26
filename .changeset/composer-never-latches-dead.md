---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Stop the agent composer from locking into a silently dead state. An
engine-readiness check that timed out or failed is now kept distinct from a
confirmed "no provider configured": it leaves the composer usable instead of
disabling it, and retries on a backoff instead of latching until reload. The
2.5s client budget that a single warm-server status probe routinely lost is
now a 15s abort ceiling rather than a deadline the probes race. A composer is
only ever disabled when the "Connect AI" affordance renders alongside it.
