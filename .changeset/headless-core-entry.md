---
"@agent-native/core": patch
---

Keep the Node package entry server-safe while preserving root server exports, so headless CLI apps load without a React installation while auth pages still render when used.
