---
"@agent-native/core": patch
---

`migrate:production` now logs how long the process took to reach the migration runtime and how long the release migrations ran, so hosted deploy logs separate startup cost from SQL time.
