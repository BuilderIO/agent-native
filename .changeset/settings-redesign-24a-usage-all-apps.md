---
"@agent-native/core": minor
---

`get-usage-metrics` now covers every app by default and takes an `app` filter (`"all"`, `"current"`, or an app key). Results add a per-app breakdown (`byApp`) that sums to the totals, the apps with usage (`apps`), `appScope`, and `currentAppKey`. The deprecated `appId` parameter still filters to one app, and today's Usage settings tab still shows the current app.
