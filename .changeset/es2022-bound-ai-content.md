---
"@agent-native/core": patch
---

Compile oversized PostHog transcript bounding against ES2022 by walking the last user message instead of using `Array.findLast`.
