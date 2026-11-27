---
"@agent-native/core": patch
---

When an agent run stops with work unfinished after exhausting its continuations, end the thread with a message naming the completed and failed tools and what was not done, instead of a bare error banner.
