---
"@agent-native/core": patch
---

Cache 404 and 410 SSR shells with the same public CDN policy as 200 shells. They previously carried `no-cache`, so every dead link, stale bookmark, renamed slug and crawler miss re-invoked the render function — the same URL cost a full cold render on every request. Netlify runs one request per container, so those invocations drew from the account-wide concurrency pool other sites share. 5xx stays uncacheable, and 401/403 are deliberately excluded.
