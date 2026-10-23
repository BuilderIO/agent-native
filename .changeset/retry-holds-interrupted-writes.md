---
"@agent-native/core": patch
---

A recovered retry of an agent turn (an agent-team attempt after a worker crash, or an A2A redelivery) now treats tool calls the earlier attempt started but never finished as having an unknown outcome. A write that is not retry-safe is held back instead of running again under a new step id, so a crashed attempt can no longer send the same email or apply the same change twice. Approval continuations and fresh turns are unchanged.

A run whose heartbeat finds its execution lease taken over now stops without attempting a terminal write its stale fence must reject, so it no longer reports a persistence error on every lost lease.
