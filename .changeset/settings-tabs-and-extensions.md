---
"@agent-native/core": patch
---

Fix `SettingsTabsPage` merging tabs into duplicate, non-adjacent settings nav sections (with duplicate React keys) whenever a different group's tabs sat between two tabs sharing the same group id.
