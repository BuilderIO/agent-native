---
"@agent-native/core": patch
---

Stop the unclaimed-background-run sweep from destroying the runs it exists to
recover. Its redispatch asserted `payloadRef: true` without checking the row
still carried a `dispatch_payload`, but sweep eligibility never implied one —
a background row can reach the grace window having never had a payload at all.
The redispatched worker then could not rehydrate a request body and failed the
run as `dispatch_payload_missing`, a reason that reads like data loss for what
is really an un-redispatchable handoff. That path accounted for 98 failed
production runs, every one of them a scheduled job.

`listUnclaimedBackgroundRunRows` now reports payload presence per row (it
reports rather than filters, so a payload-less row stays visible to the slow
sweep and cannot be stranded in `running` forever). The fast sweep skips those
rows, and the slow sweep sends them straight to its existing loud reap instead
of waiting out the redispatch bound first — the run still fails, because
nothing can rehydrate it, but with its true cause
(`background_worker_never_started`, which the client treats as recoverable).
