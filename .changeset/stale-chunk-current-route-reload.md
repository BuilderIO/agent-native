---
"@agent-native/core": patch
---

Recover from stale lazy-chunk failures on the current route. After a deploy,
an old tab whose hashed chunk filenames no longer exist would strand the user
on a broken view (and report `Failed to fetch dynamically imported module` to
Sentry) whenever the failure was not tied to a fresh cross-route navigation.
The route chunk recovery now performs a single, loop-guarded reload of the
current page (via sessionStorage cooldown) for both unhandled dynamic-import
rejections and `React.lazy` failures caught by the framework `ErrorBoundary`,
fetching fresh assets instead of failing. Desktop webviews are left untouched,
matching existing behavior.
