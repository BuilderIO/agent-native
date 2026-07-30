---
"@agent-native/core": patch
---

Make cross-app delegation ask the receiving specialist agent by default, keep
typed remote terminal states intact, retry idempotent transient transport
failures, prevent recursive agent cycles, and bound delegated context growth.
Proven durable-background delegated runs also keep the full bounded
continuation allowance while sharing one cumulative wall-clock deadline, so a
slow successful child task cannot strand its caller before the caller finishes
its own tool work. After a provider exhausts its short in-call 429/529 retry
budget, a proven background delegation now gets one cooled-down continuation,
with a hard cap that prevents sustained throttling from becoming a request
storm.

Receiving agents keep ownership of source selection, schema interpretation,
queries, joins, and their local tools. Direct read actions remain available for
exact bounded contracts, but are no longer advertised as a workaround for an
unreliable agent call.
