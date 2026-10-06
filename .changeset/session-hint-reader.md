---
"@agent-native/core": patch
---

Export `hasSessionHint()` from `@agent-native/core/client/use-session`, so an app can start a read that needs a signed-in visitor alongside the session check instead of after it. It reads the same cookie, with the same rule, as the early session read.
