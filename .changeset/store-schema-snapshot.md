---
"@agent-native/core": patch
---

Fresh databases now install the framework schema from a generated snapshot in one transaction instead of replaying every migration since the first release. A fresh release drops from about 2,500 SQL statements to about 680, and a first `pnpm dev` boot gets the same snapshot. Existing databases keep upgrading step by step.
