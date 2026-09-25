---
"@agent-native/core": patch
---

Save model provider keys at the scope the caller picks. Members save personal keys instead of getting a 403, an owner's or admin's organization key no longer deletes their personal key for that provider, and removing a key takes the same `scope`.
