---
"@agent-native/core": patch
---

Fix sign-up/sign-in bouncing back to the sign-in page when an app is served behind an https proxy with no configured public URL (e.g. a Builder Code cloud dev container rendered in the Builder editor iframe): Better Auth's session cookie and its origin/CSRF allowlist are now evaluated per request instead of once at boot, so a proxied https request gets a cross-site-safe cookie and is trusted as same-origin.
