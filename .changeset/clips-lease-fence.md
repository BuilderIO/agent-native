---
"@agent-native/core": minor
---

A worker whose lease ran out can no longer overwrite the work of the worker that took over. `@agent-native/core/db` adds leases over a table the app owns (`lease_key`, `holder`, `expires_at` in epoch milliseconds), so no migration is needed:

- `claimLease`, `renewLease`, `releaseLease`, `isLeaseHeld` and `holdsLease`.
- `leaseHeld(lease)`, a condition to put in a write's own WHERE. It is true only while the lease is still held by this token and hasn't expired, and it locks the lease row, so a takeover waits for that write to finish.
- `writeUnderLease(lease, write)`, which runs one such write and throws `LeaseLostError` (`code: "lease_lost"`, checked with `isLeaseLost`) when the write changed nothing because the lease ran out. An empty result while the lease is still held means the write's own conditions didn't match.

`compareAndSetAppState` and `appStateCompareAndSet` take an optional `lease`: the write applies only while the lease is held, and throws `LeaseLostError` when it changed nothing because the lease ran out.

Clips' thumbnail worker and track finalize write under their leases, including the application state they keep. A renew only shows nobody has taken over yet, so their storage deletes are fenced by state instead: a track finalize first marks the upload's session as discarded under its lease, and no finalize keeps a marked upload. Thumbnail and manifest files at a URL storage can hand out again (Builder and other shared providers) are left in storage; only uploads private to the run (`s3`, `clips-hosted`) are deleted when a write fails or a thumbnail is replaced. A hosted track's bytes are charged in the same transaction that marks its session counted. A thumbnail run renews its lease before it uploads. A run that lost its lease returns `skipped-lease`, which the post-finalize worker neither retries nor counts toward giving up. A thumbnail failure is recorded only while no other run holds the recording and its thumbnail status is still what the failing run read. A track finalize whose lease ran out answers its existing 409, or the finalized recording when the finalize that took over finished it.
