---
"@agent-native/core": patch
---

Return native redirect responses from web OAuth callbacks so successful sign-ins
land on the clean return URL instead of retaining provider callback query
parameters.
