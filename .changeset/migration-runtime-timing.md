---
"@agent-native/core": patch
---

`runFrameworkReleaseMigrations` now logs how long the process took to reach it and how long the framework release migrations ran (or that they failed), so hosted deploy logs separate startup cost from SQL time.
