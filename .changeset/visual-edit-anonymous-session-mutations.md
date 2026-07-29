---
"@agent-native/core": patch
---

Fix `/_agent-native/open` silently dropping a `Set-Cookie` staged during `getSession()` (e.g. `_session` query-param promotion) when it built a bare 302 `Response`, so an authenticated redirect could still leave the browser signed out. Export `redirectWithStagedCookies` so other routes can reuse the fix.
