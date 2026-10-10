---
"@agent-native/core": patch
---

Resume recovered background chat turns with durable tool results and explicit unknown-outcome context instead of replaying the original request from scratch.

Block repeated calls to a write tool after an uncertain live outcome, refresh verification reads, and preserve definite pre-execution refusals at their own action boundary.

Persist the tool-start marker before invoking writes. Classify handler failures as unknown outcomes regardless of error type; schema and authorization failures before handler entry remain definite refusals.

Reject unpersisted start markers and track custom-agent writes in the parent turn's durable recovery ledger.

Wait for the run row before persisting tool events and keep delegated call ids compatible with provider history replay.

Serialize required start markers with stale-run status updates, and expose fallback successors only after the old run is reaped.
