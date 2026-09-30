---
"@agent-native/core": patch
"@agent-native/creative-context": patch
---

Core exports execForDrizzleTransaction and lets getUserSetting and getUserLabs accept an optional transaction. Creative Context runs its lab, artifact, and pack checks on the caller's transaction when it passes db.
