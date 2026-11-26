---
"@agent-native/core": minor
---

A worker whose lease ran out can no longer overwrite the work of the worker that took over. `@agent-native/core/db` adds leases over a table the app owns (`lease_key`, `holder`, `expires_at` in epoch milliseconds), so no migration is needed:

- `claimLease`, `renewLease`, `releaseLease`, `isLeaseHeld` and `holdsLease`.
- `leaseHeld(lease)`, a condition to put in a write's own WHERE. It is true only while the lease is still held by this token and hasn't expired, and it locks the lease row, so a takeover waits for that write to finish.
- `writeUnderLease(lease, write)`, which runs one such write and throws `LeaseLostError` (`code: "lease_lost"`, checked with `isLeaseLost`) when the write changed nothing because the lease ran out. An empty result while the lease is still held means the write's own conditions didn't match.

Clips' thumbnail worker and track finalize now write under their leases. A thumbnail run whose lease ran out returns the retryable `skipped-lease` and deletes the file it uploaded, and a track finalize whose lease ran out returns its existing 409 without deleting files the new holder uses.
