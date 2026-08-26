---
"@agent-native/core": patch
---

Fix signing out briefly returning to the app shell with a data-loading error instead of the auth page. Sign-out now enters a terminal `"signing-out"` session state before the server session is revoked, so no surface renders authenticated UI or issues an authenticated request during the revoke-and-navigate window. Adds a shared `signOut()` client helper that owns the whole sequence.
