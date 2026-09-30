---
"@agent-native/core": patch
"@agent-native/recap-cli": patch
---

Scaffold configured feature dependencies and preserve long workspace URLs.
Keep optional Playwright imports external to app bundles so builds do not require its optional Chromium dependency.
