---
"@agent-native/core": patch
---

Stop emitting `X-Frame-Options: DENY` from the global security headers middleware, emit iframe-navigation COEP/CORP headers for cross-origin isolated hosts, and allow trusted app host ancestors for extension iframe documents so agent-native apps can run inside iframe hosts.
