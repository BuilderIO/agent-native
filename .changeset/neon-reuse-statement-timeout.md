---
"@agent-native/core": patch
---

Cut Neon query round trips: pooled connections keep their statement timeout between queries instead of running SET and RESET around every query.
