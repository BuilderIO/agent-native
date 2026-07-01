---
"@agent-native/core": patch
---

Fix hosted Google Analytics / Tag Manager injection by baking the measurement id into Nitro server bundles and merging the required GA/GTM script, connect, and image hosts into existing stricter document CSPs.
