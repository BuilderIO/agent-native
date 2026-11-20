---
"@agent-native/core": patch
---

A deploy that sets `AUTH_REQUIRE_EMAIL_VERIFICATION` when it builds now keeps that value in the running app, so a build-time "0" is no longer ignored by a site whose runtime settings don't repeat it. A value set on the running site still wins.
