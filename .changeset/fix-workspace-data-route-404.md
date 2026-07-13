---
"@agent-native/core": patch
---

Fix 404s when client-side navigating from the dispatch shell into a mounted workspace sub-app's root route. React Router's `.data` loader-fetch convention (e.g. `/coach.data`) didn't match either deployment platform's per-app routing rules (`basePath` / `basePath/*`), so the request fell through to a bare 404 before reaching the app's own server, leaving the sub-app stuck retrying its own action/agent-chat calls afterward.
