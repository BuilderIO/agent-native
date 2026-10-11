---
"@agent-native/toolkit": minor
---

`dbAdminBasePath` is now a deprecated runtime getter. Migrate string consumers to `getDbAdminBasePath()` so workspace paths resolve after mount metadata loads.
