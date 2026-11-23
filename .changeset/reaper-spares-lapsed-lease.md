---
"@agent-native/core": patch
---

Keep a live agent run from losing its execution lease. A chat run's 15s stale window matched its 15s lease, so the stale reaper ended a run the instant one renewal ran late, and the still-working run then stopped with `execution_lease_lost`. The reaper now leaves a run alone while its lease lapsed on its own less than one lease ago, the same rule the worker already uses to reclaim it. A run that stays silent past that window, or whose lease was revoked, is still reaped.
