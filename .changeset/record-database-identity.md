---
"@agent-native/core": patch
---

Records which app first owns a shared database, and surfaces it on
`/_agent-native/health`. `runFrameworkReleaseMigrations` now writes a
`framework.database_identity` setting (`{ app, recordedAt }`, keyed by the
app slug falling back to app id) right after the framework schema exists,
using a write-once CAS so a second app booting against the same database can
never repoint an existing record. The health probe reads it back through the
same connection its `SELECT 1` already opened, bounded by the same deadline,
and reports `database.identity` (`recorded` / `unrecorded` / `unreadable` /
`timeout`), `database.identityMismatch`, and a pooler-agnostic
`database.fingerprint` next to the existing `urlHash`. `identityMismatch` is
only ever true when a recorded identity disagrees with the app actually
running — nothing else on this axis existed before, which is how a
copy-pasted repair once pointed several beta sites' database URL at another
app's production database undetected. `scripts/smoke-check-health.ts` now
fails a deploy on `identityMismatch: true` and warns (without failing) on the
other three states.
