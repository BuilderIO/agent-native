---
"@agent-native/core": patch
---

A PR preview build no longer fails when a bundled library assigns an object with an `entry` key that reads a variable. The step that pairs the server manifest with the client build now skips objects it can't evaluate, and still fails when it finds no manifest at all.
