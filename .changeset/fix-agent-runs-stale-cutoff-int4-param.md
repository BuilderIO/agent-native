---
"@agent-native/core": patch
---

Fix `value "<ms epoch>" is out of range for type integer` aborting agent chat on
Postgres/Neon at the start of every turn.

The background-aware stale-run cutoff built SQL like
`COALESCE(heartbeat_at, started_at) >= (? - CASE WHEN dispatch_mode LIKE
'background%' THEN 90000 ELSE 15000 END)` and bound `Date.now()` to the
parameter. Postgres infers an untyped parameter's type from its surrounding
expression, and because the `15000`/`90000` window literals are `int4`, it typed
the parameter as `int4` too — so a millisecond epoch like `1782295529106`
overflowed even though every column involved is already `BIGINT`. This is a
query-level type-inference bug, independent of column types, which is why the
`widenIntColumnsToBigInt()` shim could never fix it.

The cutoff now wraps the parameter in `CAST(? AS BIGINT)`, pinning it to int8 so
the subtraction stays 64-bit. SQLite treats `CAST(x AS BIGINT)` as INTEGER
affinity, so it is a no-op there. Fixes `tryClaimRunSlot`, `reapIfStale`,
`reapAllStaleRuns`, and `cleanupOldRuns`, which all share the cutoff.
