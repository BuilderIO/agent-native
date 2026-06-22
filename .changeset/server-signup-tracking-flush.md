---
"@agent-native/core": patch
---

Track first-time Google OAuth signups and flush server-side signup tracking
before auth returns so low-volume events are delivered reliably from serverless
deployments.
