---
"@agent-native/core": patch
---

Skip notifying agent chat context subscribers when a republish leaves the items unchanged, avoiding a "Maximum update depth exceeded" render loop.
