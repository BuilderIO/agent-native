---
"@agent-native/core": patch
---

After an approved tool call runs, tell the model it already ran, keep the waiting message before the result, and resolve a later approval whose client turn id drifted.
