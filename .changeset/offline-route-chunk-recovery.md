---
"@agent-native/core": patch
---

Keep the app on screen when a route chunk fails to load while the browser is offline, and retry the clicked route once the connection returns instead of treating the failure as a stale deploy.
