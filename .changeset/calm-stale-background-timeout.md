---
"@agent-native/core": patch
---

Keep agent-chat workers on the hosted foreground timeout unless they are actually running inside a background function, preventing misrouted workers from being killed as stale runs.
