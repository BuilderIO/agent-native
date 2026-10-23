---
"@agent-native/core": patch
---

A recovered retry of an agent turn (a run that recovers completed execution steps: an agent-team attempt after a worker crash, an A2A redelivery, a reaper successor, or a client continuation) now applies the turn's unknown-outcome rules to tool calls an earlier attempt started but never finished, as an internal continuation already did. A re-planned write that may already have applied is no longer run again under a new step id, so a crashed attempt can no longer send the same email or apply the same change twice. Approval continuations and fresh turns are unchanged.

A run whose heartbeat finds its execution lease taken over now stops without attempting a terminal write its stale fence must reject, so it no longer reports a persistence error on every lost lease.
