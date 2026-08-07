---
"@agent-native/core": patch
---

Add an opt-in database-pressure reading to `/_agent-native/health?pressure=1`.
The route reports the three `pg_stat_activity` signals that preceded the
2026-08-06 analytics outage — idle-in-transaction pileup, slow trivial queries,
and one query stampeding — so a scheduled fleet audit can watch them without
holding any production database credential of its own. A dialect or connection
that cannot answer reports `measured: false` with a reason rather than a clean
zero, and pressure never changes `ready` or the response status.
