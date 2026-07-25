---
"@agent-native/core": patch
---

Sign the A2A identity token's audience as the target's origin. Receivers derive their expected audience from `APP_URL`, which carries no app path, so a path-qualified audience could never match — every direct `actions/invoke` between workspace apps failed with "Invalid or expired A2A token".
