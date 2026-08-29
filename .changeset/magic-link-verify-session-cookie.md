---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session after verify. Hosted 302s were keeping `set-auth-token` and omitting `Set-Cookie`. The continue page no longer sends a `Location` header (browsers were treating 200+Location as a redirect and skipping cookies), sets a first-party Lax cookie from script before navigating, and persists that token so `/session` can resolve it.
