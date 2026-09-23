---
"@agent-native/core": patch
---

Single-key `getSetting` reads throw again on a corrupt stored value instead of reporting it as missing; batched `getSettings` reads still isolate a corrupt key.
