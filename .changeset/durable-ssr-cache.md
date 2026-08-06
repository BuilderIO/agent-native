---
"@agent-native/core": patch
---

Use Netlify's durable cache for public SSR shells so edge misses reuse the shared response instead of invoking the serverless renderer again.
