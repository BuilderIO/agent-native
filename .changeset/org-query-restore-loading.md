---
"@agent-native/core": patch
---

`useOrg()` reports `isLoading` while the cached action restore holds its query, so an app no longer reads the unloaded org as "no org" and sends an open deck back to the deck list.
