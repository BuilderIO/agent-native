---
"@agent-native/core": patch
---

`skills add` no longer reports a skill as connected when its browser sign-in fails or times out. It now prints the command to finish signing in later, as it already did when the sign-in threw an error.
