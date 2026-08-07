---
"@agent-native/core": patch
---

Stop a refused database connection from immediately producing another attempt.

Neon rejects a connection _attempt_, not a connection: "Failed to acquire
permit to connect to the database. Too many database connection attempts are
currently ongoing." A failed acquire leaves the pool with zero idle clients, so
the next `execute()` calls `connect()` again — and `retryOnConnectionError`
backs off only 100ms. The process answered each refusal by manufacturing the
next attempt, which is what kept the refusal true; production stayed wedged
until the compute was restarted by hand.

Every Neon pool now passes through `guardNeonPool` (renamed from
`attachNeonPoolErrorLogger`), which holds a short jittered per-endpoint
cooldown after a failed attempt. Checking out an already-idle client is not an
attempt and still succeeds, so a cooldown degrades throughput instead of taking
a warm instance offline. `DbConnectCooldownError` is deliberately not
classified as a connection error, so the retry loop exits instead of re-entering
the storm, and it reads as transient so shed load surfaces as 503 rather than 500. Tune with `DB_CONNECT_COOLDOWN_MS`.

The added `url` argument makes any pool that skips the gate a compile error
rather than a silent bypass.
