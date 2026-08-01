---
"@agent-native/core": patch
---

Give compare-and-swap writes an atomic path on Cloudflare D1

D1 has no interactive transactions: `db.transaction()` issues a bare `BEGIN`,
which D1 rejects with `Failed query: begin`. Any read/compare-and-swap/confirm
write expressed as a transaction therefore could not run at all on that platform
— on a Worker the Design template's design-data writes failed on every attempt,
so the agent could not save generated work.

`runCompareAndSwap` (exported from `@agent-native/core/db`) runs that shape on
every dialect, choosing an interactive transaction where the dialect has one and
D1's implicit-transaction `batch()` where it does not. The write and its
confirmation read are always in the same atomic unit, which is what makes the
caller's equality check conclusive. On D1 the initial read is outside that unit,
so a sibling writer may commit before the CAS — precisely the case the guarded
predicate and the confirmation read exist to detect, and it retries like any
other lost CAS.

The dialect branch lives in core, not at the call site, so template code keeps
using the shared query builder and never asks which database it is on. A D1
client that exposes no `batch()` is a wiring error and says so, rather than
falling through to a `BEGIN` that names the wrong cause.
