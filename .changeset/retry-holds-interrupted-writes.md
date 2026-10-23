---
"@agent-native/core": patch
---

A recovered retry of an agent turn (a run that recovers completed execution steps: an agent-team attempt after a worker crash, an A2A redelivery, a reaper successor, or a client continuation) now treats tool calls an earlier attempt started but never finished as having an unknown outcome. A write that is not retry-safe for its recorded input is held back instead of running again under a new step id, so a crashed attempt can no longer send the same email or apply the same change twice. Writes declared retry-safe can still be corrected and re-run. Approval continuations and fresh turns are unchanged.

A run whose heartbeat finds its execution lease taken over now stops without attempting a terminal write its stale fence must reject, so it no longer reports a persistence error on every lost lease.
