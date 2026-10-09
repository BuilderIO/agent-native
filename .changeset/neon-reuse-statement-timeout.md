---
"@agent-native/core": patch
---

Cut Neon query round trips: pooled connections start at the default statement timeout, so default-budget queries no longer run SET and RESET around every query. Custom-budget queries still reset the timeout before their connection returns to the pool.
