---
"@agent-native/core": patch
---

Route opted-in async A2A tasks through Netlify's durable background worker so long analytics queries are not killed by the foreground function timeout.
