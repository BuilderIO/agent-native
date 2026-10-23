---
"@agent-native/core": patch
---

A recovered retry of an agent turn (a run that recovers completed execution steps: an agent-team attempt after a worker crash, an A2A redelivery, a reaper successor, or a client continuation) now treats tool calls an earlier attempt started but never finished as having an unknown outcome. A write that is not retry-safe is held back instead of running again under a new step id, so a crashed attempt can no longer send the same email or apply the same change twice. Retry safety is judged on the arguments of the call about to run: a write retry-safe for those arguments may be corrected and re-run after an unknown outcome, on recovered retries and internal continuations alike, as `retrySafe` promises. Approval continuations and fresh turns are unchanged.

A run whose heartbeat finds its execution lease taken over now stops without attempting a terminal write its stale fence must reject, so it no longer reports a persistence error on every lost lease.
