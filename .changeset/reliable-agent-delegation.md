---
"@agent-native/core": patch
---

Make cross-app delegation ask the receiving specialist agent by default, keep
typed remote terminal states intact, retry idempotent transient transport
failures, prevent recursive agent cycles, and bound delegated context growth.

Receiving agents keep ownership of source selection, schema interpretation,
queries, joins, and their local tools. Direct read actions remain available for
exact bounded contracts, but are no longer advertised as a workaround for an
unreliable agent call.
