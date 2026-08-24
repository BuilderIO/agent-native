---
"@agent-native/toolkit": patch
---

Stop silently dropping a collaborator's edits. A client that was not the reconcile lead never marked itself seeded, so its own changes were never written back
to SQL — they survived in the shared CRDT while a peer stayed connected and disappeared when that peer left. Read-only viewers were also counted in the lead
election, so a viewer could win it and then apply nothing at all, leaving a session where every editor's work was dropped.
