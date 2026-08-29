---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session after verify. `getSession` now waits for Better Auth to initialize and passes a real Cookie header (from `getHeader`) into `ba.api.getSession`. Successful magic-link verify also sets the framework session cookie the same way password login does, so the legacy fallback can resolve the session on the next request.
