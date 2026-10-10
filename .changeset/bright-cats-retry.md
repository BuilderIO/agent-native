---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Retry transient chat route verification without replacing a restored tab, and only confirm a legacy snapshot fallback after the host save succeeds. Keep the exported chat header prop optional for existing consumers.
