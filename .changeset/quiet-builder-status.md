---
"@agent-native/core": patch
---

Keep upload status available when a provider credential cannot be read, and honor organization credential precedence for owners and admins with unreadable personal Builder keys. Report Builder reauthorization separately from temporary credential-store failures.

Return `configured: null` for indeterminate upload status so existing clients retain their unavailable state. Preserve provider priority and the lookup failure that requires retrying.
